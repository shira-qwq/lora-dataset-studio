import type { PreviewDetail } from '../../api/client';

export interface RiskResult {
  warnings: string[];
  errors: string[];
}

/**
 * Analyze a preview's diff/metrics and return risk warnings/errors.
 * Thresholds match the vanilla recluster-preview.js exactly.
 */
export function analyzeRisk(detail: PreviewDetail): RiskResult {
  const dif = detail.diff_vs_current || {} as any;
  const warnings: string[] = [];
  const errors: string[] = [];

  // changed ratio
  const changedRatio = dif.changed_cluster_ratio;
  if (changedRatio != null) {
    if (changedRatio > 0.40) {
      errors.push('超过 40% 的图片会改变簇归属，属于重大变化');
    } else if (changedRatio > 0.25) {
      warnings.push('超过 25% 的图片会改变簇归属');
    }
  }

  // noise rate
  const newNoise = dif.new_noise_rate;
  const oldNoise = dif.old_noise_rate;
  if (newNoise != null && oldNoise != null) {
    if (newNoise > 35) {
      errors.push('新聚类的 noise 率超过 35%，可能过度分割');
    } else if (newNoise > oldNoise + 10) {
      warnings.push('新聚类的 noise 率比当前高出超过 10%');
    }
  }

  // largest cluster ratio
  const newLcr = dif.new_largest_cluster_ratio;
  if (newLcr != null) {
    if (newLcr > 0.55) {
      errors.push('最大簇占比超过 55%，可能出现严重不平衡');
    } else if (newLcr > 0.45) {
      warnings.push('最大簇占比超过 45%');
    }
  }

  // cluster count change
  const oldCc = dif.old_cluster_count;
  const newCc = dif.new_cluster_count;
  if (oldCc != null && newCc != null && oldCc > 0) {
    const changePct = Math.abs(newCc - oldCc) / oldCc;
    if (changePct > 0.5) {
      warnings.push('簇数量变化超过 50%');
    }
  }

  return { warnings, errors };
}
