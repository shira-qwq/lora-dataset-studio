import { useMemo, useState } from 'react';
import { ANALYSIS_PRESETS } from '../../config/runConfig';

interface ClusteringPresetCardProps {
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  disabled?: boolean;
}

function formatWeights(presetId: string): string {
  if (presetId === 'balanced') return '16 维权重全部为 1.0';
  const preset = ANALYSIS_PRESETS.find((item) => item.id === presetId);
  if (!preset) return '使用自定义权重';
  const weights = preset.buildConfig().clustering.feature_weights;
  const changed = Object.entries(weights)
    .filter(([, value]) => Number(value) !== 1)
    .slice(0, 4)
    .map(([key, value]) => `${key}=${value}`);
  return changed.length ? changed.join(' / ') : '16 维权重全部为 1.0';
}

export default function ClusteringPresetCard({
  selectedPresetId,
  onSelectPreset,
  disabled,
}: ClusteringPresetCardProps) {
  const [showConfig, setShowConfig] = useState(false);
  const activePreset = useMemo(
    () => ANALYSIS_PRESETS.find((preset) => preset.id === selectedPresetId),
    [selectedPresetId],
  );
  const activeConfig = activePreset?.buildConfig();

  return (
    <div style={styles.card}>
      <div style={styles.stepHeader}>
        <span style={styles.stepNum}>3</span>
        <div>
          <div style={styles.stepTitle}>聚类配置</div>
          <div style={styles.stepDesc}>选择真实写入 run_config 并进入 pipeline 的聚类预设。</div>
        </div>
      </div>

      <div style={styles.presetGrid}>
        {ANALYSIS_PRESETS.map((preset) => {
          const isActive = preset.id === selectedPresetId;
          const config = preset.buildConfig();
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectPreset(preset.id)}
              style={{
                ...styles.presetCard,
                ...(isActive ? styles.presetCardActive : {}),
                opacity: disabled ? 0.55 : 1,
              }}
            >
              <div style={styles.presetNameRow}>
                <span style={styles.presetName}>{preset.label_zh}</span>
                {isActive && <span style={styles.activeBadge}>当前</span>}
              </div>
              <div style={styles.presetDesc}>{preset.description_zh}</div>
              <div style={styles.effectBox}>
                <div><strong>已生效：</strong>UMAP n_neighbors / min_dist</div>
                <div><strong>已生效：</strong>HDBSCAN min_cluster_size / min_samples</div>
                <div><strong>已生效：</strong>{formatWeights(preset.id)}</div>
                <div><strong>写入：</strong>{config.clustering_preset_id}</div>
              </div>
              {preset.risk_zh && preset.risk_zh.length > 0 && (
                <div style={styles.riskText}>{preset.risk_zh.join('；')}</div>
              )}
            </button>
          );
        })}

        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectPreset('custom')}
          style={{
            ...styles.presetCard,
            ...(selectedPresetId === 'custom' ? styles.presetCardActive : {}),
            opacity: disabled ? 0.55 : 1,
          }}
        >
          <div style={styles.presetNameRow}>
            <span style={styles.presetName}>自定义</span>
            {selectedPresetId === 'custom' && <span style={styles.activeBadge}>当前</span>}
          </div>
          <div style={styles.presetDesc}>手动调整 16 维权重、UMAP 和 HDBSCAN 参数。</div>
          <div style={styles.effectBox}>
            <div><strong>已生效：</strong>自定义 16 维权重</div>
            <div><strong>已生效：</strong>UMAP / HDBSCAN 显式参数</div>
            <div><strong>写入：</strong>custom</div>
          </div>
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowConfig((value) => !value)}
        style={styles.configToggle}
      >
        <span>{activePreset ? activePreset.label_zh : '自定义'} · 配置细节</span>
        <span>{showConfig ? '收起' : '展开'}</span>
      </button>

      {showConfig && (
        <div style={styles.configSection}>
          {activeConfig ? (
            <>
              <div style={styles.configRow}>
                <span style={styles.configLabel}>特征权重</span>
                <span style={styles.configValue}>{formatWeights(activePreset?.id || selectedPresetId)}</span>
              </div>
              <div style={styles.configRow}>
                <span style={styles.configLabel}>UMAP 邻居数</span>
                <span style={styles.configValue}>{activeConfig.clustering.umap?.n_neighbors ?? 15}</span>
              </div>
              <div style={styles.configRow}>
                <span style={styles.configLabel}>UMAP 紧凑度</span>
                <span style={styles.configValue}>{activeConfig.clustering.umap?.min_dist ?? 0.1}</span>
              </div>
              <div style={styles.configRow}>
                <span style={styles.configLabel}>最小簇大小</span>
                <span style={styles.configValue}>{activeConfig.clustering.hdbscan?.min_cluster_size ?? 6}</span>
              </div>
              <div style={styles.configRow}>
                <span style={styles.configLabel}>核心样本数</span>
                <span style={styles.configValue}>{activeConfig.clustering.hdbscan?.min_samples ?? 3}</span>
              </div>
            </>
          ) : (
            <div style={styles.customHint}>
              自定义配置会使用下方“自定义配置包”中的当前数值，启动任务时写入 run_config.json。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  stepHeader: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: 'var(--accent, #7c9bff)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text, #e0e0e8)' },
  stepDesc: { fontSize: 11, color: 'var(--text-muted, #888)', marginTop: 2 },
  presetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 8,
  },
  presetCard: {
    textAlign: 'left',
    padding: 12,
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 9,
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text, #e0e0e8)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  presetCardActive: {
    borderColor: 'var(--accent, #7c9bff)',
    background: 'var(--chip-active-bg, rgba(124,155,255,0.1))',
    boxShadow: '0 0 0 1px var(--accent-soft, rgba(124,155,255,0.2))',
  },
  presetNameRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  presetName: { fontSize: 13, fontWeight: 800 },
  activeBadge: {
    padding: '1px 6px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--accent, #7c9bff)',
    background: 'var(--accent-soft, rgba(124,155,255,0.16))',
  },
  presetDesc: { minHeight: 34, fontSize: 11, lineHeight: 1.5, color: 'var(--text-muted, #888)' },
  effectBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: 7,
    background: 'var(--bg-soft, rgba(255,255,255,0.035))',
    fontSize: 10,
    lineHeight: 1.55,
    color: 'var(--text-muted, #888)',
  },
  riskText: { marginTop: 6, fontSize: 10, color: 'var(--warning, #f5a623)', lineHeight: 1.45 },
  configToggle: {
    marginTop: 10,
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '7px 9px',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 7,
    background: 'var(--bg, #12121a)',
    color: 'var(--text-muted, #888)',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  configSection: {
    marginTop: 8,
    padding: '8px 10px',
    borderRadius: 7,
    border: '1px solid var(--border, #2a2a3e)',
    background: 'var(--bg, #12121a)',
  },
  configRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    padding: '5px 0',
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  configLabel: { fontSize: 11, color: 'var(--text-muted, #888)', fontWeight: 700 },
  configValue: { fontSize: 11, color: 'var(--text-faint, #777)', textAlign: 'right', wordBreak: 'break-all' },
  customHint: { fontSize: 11, color: 'var(--text-muted, #888)', lineHeight: 1.6 },
};
