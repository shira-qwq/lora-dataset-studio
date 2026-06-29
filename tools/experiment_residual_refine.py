#!/usr/bin/env python3
"""Residual refine experiment (v4.4j).

Usage:
    python tools/experiment_residual_refine.py --job-output <job> --mode all
"""

import argparse, csv, json, sys, hashlib, time, math
from pathlib import Path
from collections import Counter

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from lighting_engine.core.experiments.residual_refine import (
    load_residual_matrix, scale_residual_matrix, load_default_labels,
    run_clustering, refine_two_stage, compute_cohesion, compute_label_entropy,
    composite_score, RECIPES, recipe_hash,
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-output", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", choices=["baseline", "global", "two_stage", "all"], default="all")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--use-cache", action="store_true")
    parser.add_argument("--no-cache", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    labels_dir = out_dir / "labels_by_recipe"
    labels_dir.mkdir(exist_ok=True)

    use_cache = args.use_cache and not args.no_cache
    job_dir = Path(args.job_output)

    print(f"Loading residual matrix from {job_dir}...")
    matrix, col_names, meta, img_map, img_paths = load_residual_matrix(str(job_dir))
    print(f"  Matrix: {matrix.shape} ({meta['total_dims']} dims, {meta['n']} images)")

    matrix_scaled = scale_residual_matrix(matrix)
    mhash = hashlib.md5(matrix_scaled.tobytes()).hexdigest()[:12]
    print(f"  Matrix checksum: {mhash}")

    # Baseline (A)
    print("\n--- A: Default Baseline ---")
    default_labels = load_default_labels(str(job_dir), img_paths)
    a_metrics = {
        "n_clusters": len(set(l for l in default_labels if l >= 0)),
        "noise_rate": round(float(np.mean(default_labels == -1)), 4),
    }
    sizes = [int(np.sum(default_labels == l)) for l in set(default_labels) if l >= 0]
    a_metrics["largest_cluster_ratio"] = round(max(sizes) / max(len(default_labels), 1), 4)
    a_metrics["histogram_cohesion"] = compute_cohesion(matrix_scaled, default_labels)
    a_metrics["quality"] = "baseline"
    print(f"  Clusters: {a_metrics['n_clusters']}, Noise: {a_metrics['noise_rate']:.2%}, LCR: {a_metrics['largest_cluster_ratio']:.3f}")

    # Run recipes
    all_metrics = {}

    for rname, rparams in RECIPES.items():
        mode = args.mode
        if mode != "all":
            if mode == "global" and not rname.startswith("B"):
                continue
            if mode == "two_stage" and not rname.startswith("C"):
                continue

        print(f"\n--- {rname}: {rparams.get('mode', '?')} ---")
        if rparams["mode"] == "global":
            result = run_clustering(matrix_scaled, rparams, args.seed)
            labels = np.array(result["labels"])
            n_clusters = result["n_clusters"]
            changed = int(np.sum(labels != default_labels))
            changed_ratio = changed / max(len(labels), 1)

            metrics = {
                "n_clusters": n_clusters,
                "noise_rate": result["noise_rate"],
                "largest_cluster_ratio": result["largest_cluster_ratio"],
                "silhouette": result["silhouette"],
                "histogram_cohesion": compute_cohesion(matrix_scaled, labels),
                "label_entropy": compute_label_entropy(labels),
                "changed_count": changed,
                "changed_image_ratio": round(changed_ratio, 4),
            }
            score, elim, reason = composite_score(metrics, rname)
            metrics["composite_score"] = score
            metrics["eliminated"] = elim
            metrics["elimination_reason"] = reason

            # Save labels
            lf = labels_dir / f"{rname}_labels.csv"
            pd.DataFrame({"image_path": img_paths, f"{rname}_label": labels}).to_csv(lf, index=False)

            print(f"  Clusters: {n_clusters}, Sil: {result['silhouette']:.4f}, Score: {score:.4f}")
            if elim:
                print(f"  ELIMINATED: {reason}")
            all_metrics[rname] = metrics

        elif rparams["mode"] in ("adaptive", "two_stage"):
            if rparams["mode"] == "adaptive":
                from lighting_engine.core.experiments.residual_refine import refine_adaptive
                refine = refine_adaptive(matrix_scaled, img_paths, default_labels, rparams, args.seed)
            else:
                refine = refine_two_stage(matrix_scaled, img_paths, default_labels, rparams, args.seed)
            res = refine["result"]
            labels = np.array(res["labels"])
            n_clusters = res["n_clusters"]

            metrics = {
                "n_clusters": n_clusters,
                "noise_rate": round(float(np.mean(labels == -1)), 4),
                "changed_count": res["changed_count"],
                "changed_image_ratio": res["changed_ratio"],
                "histogram_cohesion": compute_cohesion(matrix_scaled, labels),
                "label_entropy": compute_label_entropy(labels),
            }
            sizes = [int(np.sum(labels == l)) for l in set(labels) if l >= 0]
            metrics["largest_cluster_ratio"] = round(max(sizes) / max(len(labels), 1), 4)

            accepted = sum(1 for d in refine["refine_decisions"] if d.get("accepted"))
            rejected = sum(1 for d in refine["refine_decisions"] if d.get("attempted") and not d.get("accepted"))
            metrics["accepted_refine_count"] = accepted
            metrics["rejected_refine_count"] = rejected
            metrics["refined_cluster_count"] = n_clusters
            metrics["refined_image_count"] = int(np.sum(labels != default_labels))

            score, elim, reason = composite_score(metrics, rname)
            metrics["composite_score"] = score
            metrics["eliminated"] = elim
            metrics["elimination_reason"] = reason

            # Save labels
            lf = labels_dir / f"{rname}_labels.csv"
            pd.DataFrame({"image_path": img_paths, f"{rname}_label": labels}).to_csv(lf, index=False)

            # Save decisions
            df = pd.DataFrame(refine["refine_decisions"])
            df.to_csv(out_dir / f"refine_decisions_{rname}.csv", index=False)

            print(f"  Clusters: {n_clusters}, Accepted refine: {accepted}, Rejected: {rejected}, Score: {score:.4f}")
            if elim:
                print(f"  ELIMINATED: {reason}")
            all_metrics[rname] = metrics

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    rows = []
    for rname, m in sorted(all_metrics.items()):
        elim = "❌" if m.get("eliminated") else "✅"
        print(f"  {elim} {rname}: clusters={m.get('n_clusters',0)} noise={m.get('noise_rate',0):.2%} "
              f"score={m.get('composite_score',0):.4f} {m.get('elimination_reason','')}")
        rows.append({"recipe": rname, **m})

    # Write summary
    summary = {
        "dataset": str(job_dir),
        "matrix_shape": list(matrix.shape),
        "matrix_checksum": mhash,
        "n_images": meta["n"],
        "baseline_metrics": a_metrics,
        "recipes": all_metrics,
        "default_clustering_unchanged": True,
    }
    with open(out_dir / "residual_refine_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    if rows:
        # Collect all possible field names from all rows
        all_keys = set()
        for row in rows:
            all_keys.update(row.keys())
        all_keys = sorted(all_keys)
        with open(out_dir / "residual_refine_metrics.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=all_keys, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    print(f"\nOutput: {out_dir}")
    print("Default clustering unchanged: True")


if __name__ == "__main__":
    main()
