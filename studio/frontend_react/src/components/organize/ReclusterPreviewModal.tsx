/**
 * ReclusterPreviewModal — 重聚类预览 Modal (v4.5)
 *
 * 依赖 P0-A: createPreview / listPreviews / getPreviewDetail / applyPreview
 *       / ManualEditsError / FALLBACK_RECIPES / RecipeName / PreviewSummary / PreviewDetail
 *
 * 两栏布局 + 风险提示 + Apply 二层确认，复刻 vanilla recluster-preview.js 的交互流程。
 */

import { useState, useEffect, useCallback } from 'react';
import type { PreviewSummary, PreviewDetail, RecipeName } from '../../api/client';
import {
  createPreview, listPreviews, getPreviewDetail, applyPreview,
  ManualEditsError, FALLBACK_RECIPES,
} from '../../api/client';
import { analyzeRisk } from './reclusterRisk';

interface Props {
  jobId: string;
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

// ── helpers ──

function fmtNum(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return '—';
  return Number(v).toLocaleString();
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return '—';
  return (Number(v) * 100).toFixed(1) + '%';
}

function fmtPctRaw(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return '—';
  return Number(v).toFixed(1) + '%';
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}

function recipeLabel(name: string): string {
  const found = FALLBACK_RECIPES.find(r => r.name === name);
  return found ? found.label : name;
}

// ── component ──

export default function ReclusterPreviewModal({ jobId, open, onClose, onApplied }: Props) {
  const [previews, setPreviews] = useState<PreviewSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PreviewDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load previews on mount
  useEffect(() => {
    if (!open) return;
    setError(null);
    listPreviews(jobId)
      .then(setPreviews)
      .catch(e => setError(e.message));
  }, [open, jobId]);

  // Load detail when selectedId changes
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setLoadingDetail(true);
    setError(null);
    getPreviewDetail(jobId, selectedId)
      .then(setDetail)
      .catch(e => setError(e.message))
      .finally(() => setLoadingDetail(false));
  }, [jobId, selectedId]);

  // Create preview
  const handleCreate = useCallback(async (recipeName: RecipeName) => {
    setCreating(true);
    setError(null);
    try {
      const result = await createPreview(jobId, recipeName);
      // Refresh list and auto-select the new preview
      const updated = await listPreviews(jobId);
      setPreviews(updated);
      setSelectedId(result.preview_id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }, [jobId]);

  // Apply
  const handleApply = useCallback(async (force: boolean) => {
    if (!selectedId) return;
    setError(null);
    try {
      await applyPreview(jobId, selectedId, force);
      onApplied();
      onClose();
    } catch (e: any) {
      if (e instanceof ManualEditsError) {
        // Second confirmation for force
        const ok = window.confirm(
          '检测到当前 job 已有人工整理/移动/重命名状态。\n' +
          '强制应用可能覆盖当前整理结果。\n' +
          '建议先导出或确认已经备份。\n' +
          '只有确定要覆盖时才继续。'
        );
        if (!ok) return;
        // Recursive call with force=true
        handleApply(true);
        return;
      }
      setError(e.message);
    }
  }, [jobId, selectedId, onApplied, onClose]);

  const handleApplyClick = useCallback(() => {
    if (!detail) return;
    const ok = window.confirm('应用预览将覆盖当前聚类结果。是否继续？');
    if (!ok) return;
    handleApply(false);
  }, [detail, handleApply]);

  // ── style constants ──
  const sBtn: React.CSSProperties = {
    padding: '6px 14px', background: '#3a3a5e', color: '#ccc',
    border: '1px solid #4a4a6e', borderRadius: 4, cursor: 'pointer',
    fontSize: 12, fontFamily: 'inherit', fontWeight: 600,
  };
  const sBtnAccent: React.CSSProperties = {
    ...sBtn, background: '#7c9bff', color: '#12121a', border: 'none',
  };
  const sBtnDanger: React.CSSProperties = {
    ...sBtn, background: '#e74c3c', color: '#fff', border: 'none',
  };

  if (!open) return null;

  // ── right column content ──
  let rightContent: React.ReactNode;

  if (loadingDetail) {
    rightContent = <div style={{ textAlign: 'center', padding: 40, color: '#666', fontSize: 13 }}>加载详情中...</div>;
  } else if (!detail) {
    rightContent = <div style={{ textAlign: 'center', padding: 40, color: '#666', fontSize: 13 }}>请选择或创建一个预览</div>;
  } else {
    const risk = analyzeRisk(detail);
    const hasRisk = risk.warnings.length > 0 || risk.errors.length > 0;
    const dif = detail.diff_vs_current || {} as any;
    const met = detail.preview_metrics || {} as any;

    const riskHtml = hasRisk ? (
      <div style={{ background: 'rgba(255,183,77,0.08)', border: '1px solid #ffb74d', borderRadius: 6, padding: '10px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#ffb74d', marginBottom: 4 }}>风险提示</div>
        {risk.errors.map((msg, i) => (
          <div key={`e${i}`} style={{ color: '#e74c3c', fontSize: 12, padding: '2px 0' }}>⚠ {msg}</div>
        ))}
        {risk.warnings.map((msg, i) => (
          <div key={`w${i}`} style={{ color: '#ffb74d', fontSize: 12, padding: '2px 0' }}>⚠ {msg}</div>
        ))}
      </div>
    ) : null;

    const metricsTable = (
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '2px solid #2a2a3e', color: '#888', fontWeight: 600 }}>指标</th>
            <th style={{ padding: '4px 8px', textAlign: 'center', borderBottom: '2px solid #2a2a3e', color: '#888', fontWeight: 600 }}>当前</th>
            <th style={{ padding: '4px 8px', textAlign: 'center', borderBottom: '2px solid #2a2a3e', color: '#7c9bff', fontWeight: 600 }}>预览</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['簇数量', fmtNum(dif.old_cluster_count), fmtNum(dif.new_cluster_count)],
            ['Noise 率', fmtPctRaw(dif.old_noise_rate), fmtPctRaw(dif.new_noise_rate)],
            ['Silhouette', '—', met.silhouette != null ? Number(met.silhouette).toFixed(4) : '—'],
            ['最大簇占比', fmtPct(dif.old_largest_cluster_ratio), fmtPct(dif.new_largest_cluster_ratio)],
            ['变化图片', '—', `${fmtNum(dif.changed_cluster_count)} / ${fmtNum(dif.total_images)} (${fmtPct(dif.changed_cluster_ratio)})`],
          ].map(([label, cur, prv]) => (
            <tr key={label} style={{ borderBottom: '1px solid #2a2a3e' }}>
              <td style={{ padding: '4px 8px', color: '#aaa' }}>{label}</td>
              <td style={{ padding: '4px 8px', textAlign: 'center', color: '#ccc' }}>{cur}</td>
              <td style={{ padding: '4px 8px', textAlign: 'center', color: '#ccc', fontWeight: 500 }}>{prv}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );

    const featHtml = (
      <div style={{ marginBottom: 12, fontSize: 11, lineHeight: 1.6 }}>
        {(met.alive_feature_names && (met.alive_feature_names as string[]).length > 0) && (
          <div><span style={{ color: '#888' }}>特征: </span><span style={{ color: '#ccc' }}>{(met.alive_feature_names as string[]).join(', ')}</span></div>
        )}
        {(met.dead_features && (met.dead_features as string[]).length > 0) && (
          <div><span style={{ color: '#888' }}>死亡特征: </span><span style={{ color: '#e74c3c' }}>{(met.dead_features as string[]).join(', ')}</span></div>
        )}
      </div>
    );

    rightContent = (
      <div>
        {riskHtml}
        <div style={{ fontSize: 14, fontWeight: 600, color: '#ddd', marginBottom: 8 }}>
          {recipeLabel(detail.recipe?.recipe_name || '')}
          <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
            {fmtDateTime(detail.preview_metrics?.created_at)}
          </span>
        </div>
        {metricsTable}
        {featHtml}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={handleApplyClick} style={risk.errors.length > 0 ? sBtnDanger : sBtnAccent}>
            应用此预览
          </button>
          <button onClick={onClose} style={sBtn}>关闭</button>
        </div>
      </div>
    );
  }

  // ── left column: recipe selector + preview list ──
  const leftColumn = (
    <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid #2a2a3e', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Recipe section */}
      <div style={{ padding: 12, borderBottom: '1px solid #2a2a3e' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc', marginBottom: 6 }}>选择 Recipe</div>
        <select id="rp-recipe-select" style={{
          width: '100%', padding: '5px 8px', background: '#12121a',
          border: '1px solid #3a3a4e', color: '#ccc', borderRadius: 4, fontSize: 12, outline: 'none', marginBottom: 6,
        }}>
          {FALLBACK_RECIPES.map(r => (
            <option key={r.name} value={r.name}>{r.label}</option>
          ))}
        </select>
        <button
          onClick={() => {
            const sel = (document.getElementById('rp-recipe-select') as HTMLSelectElement)?.value as RecipeName;
            if (sel) handleCreate(sel);
          }}
          disabled={creating}
          style={{ width: '100%', padding: '6px 0', background: creating ? '#2a2a3e' : '#7c9bff', color: creating ? '#666' : '#12121a', border: 'none', borderRadius: 4, cursor: creating ? 'default' : 'pointer', fontSize: 12, fontWeight: 600 }}>
          {creating ? '生成中...' : '创建预览'}
        </button>
      </div>

      {/* Preview list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        <div style={{ padding: '0 12px 6px', fontSize: 11, fontWeight: 600, color: '#666' }}>已有预览</div>
        {previews.length === 0 ? (
          <div style={{ padding: '12px', color: '#666', fontSize: 12, textAlign: 'center' }}>还没有预览，请选择 recipe 后创建</div>
        ) : (
          previews.map(p => {
            const isSel = p.preview_id === selectedId;
            let dotColor = '#2ecc71';
            const r = p.diff_summary?.changed_cluster_ratio;
            if (r != null) {
              if (r > 0.4) dotColor = '#e74c3c';
              else if (r > 0.25) dotColor = '#ffb74d';
            }
            return (
              <div key={p.preview_id}
                onClick={() => setSelectedId(p.preview_id)}
                style={{
                  padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                  background: isSel ? '#12121a' : '',
                  borderLeft: isSel ? '3px solid #7c9bff' : '3px solid transparent',
                  borderBottom: '1px solid #2a2a3e',
                  transition: 'background 0.1s',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  <span style={{ fontWeight: 500, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {recipeLabel(p.recipe_name)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#888' }}>
                  <span>{p.metrics?.n_clusters != null ? `${p.metrics.n_clusters} 簇` : ''}</span>
                  <span>{p.metrics?.silhouette != null ? `Sil: ${Number(p.metrics.silhouette).toFixed(3)}` : ''}</span>
                  {r != null && <span style={{ color: dotColor }}>{fmtPct(r)}</span>}
                </div>
                <div style={{ fontSize: 10, color: '#555' }}>{fmtDateTime(p.metrics?.created_at)}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // ── main render ──
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 99998, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <div style={{
        background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 10,
        width: 'min(900px, calc(100vw - 48px))', height: 'min(600px, calc(100vh - 80px))',
        display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.5)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #2a2a3e', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#ddd' }}>🔬 重聚类预览</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18, padding: '4px 8px' }}>&times;</button>
        </div>

        {/* Body: two columns */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {leftColumn}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {error && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(231,76,60,0.08)', borderRadius: 4, fontSize: 12, color: '#e74c3c' }}>
                {error}
              </div>
            )}
            {rightContent}
          </div>
        </div>
      </div>
    </div>
  );
}
