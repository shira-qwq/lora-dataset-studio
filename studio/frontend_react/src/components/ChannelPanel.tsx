/**
 * ChannelPanel — 分析通道面板组件
 *
 * 以整理能力分组展示 channel 的状态、字段摘要、排序/筛选入口和空状态。
 * 普通视图隐藏 debug-only 字段，Debug 视图全部展示。
 *
 * P09-002: 所有颜色通过 CSS 变量定义，移除 hardcoded colors。
 */

import type { ChannelCapability } from '../api/client';
import { getFieldsByChannel, getFieldMeta } from '../i18n/fieldDictionary';
import { t } from '../i18n/uiDictionary';

export interface PanelChannelEntry {
  /** API channel key, e.g. 'basic_metadata' */
  key: string;
  /** Capability from backend manifest */
  capability?: ChannelCapability;
  /** Whether this channel is currently being built */
  building: boolean;
}

interface ChannelPanelProps {
  /** Unique panel key */
  panelKey: string;
  /** Panel title (already translated) */
  title: string;
  /** Panel description (already translated) */
  description: string;
  /** Emoji icon */
  icon: string;
  /** Channels in this panel (usually 1) */
  channels: PanelChannelEntry[];
  /** Whether debug/expert fields should be shown */
  showDebug: boolean;
  /** Called when user wants to sort a channel */
  onSort?: (channelKey: string, sortField: string) => void;
  /** Called when user wants to filter a channel */
  onFilter?: (channelKey: string) => void;
  /** Called when user wants to build a channel */
  onBuild?: (channelKey: string) => void;
  /** Called when user wants to view channel data */
  onViewData?: (channelKey: string) => void;
  /** Currently active viewing channel */
  activeViewChannel?: string | null;
}

export default function ChannelPanel({
  title,
  description,
  icon,
  channels,
  showDebug,
  onFilter,
  onBuild,
  onViewData,
  activeViewChannel,
}: ChannelPanelProps) {
  // Determine overall panel status
  const anyBuilt = channels.some((ch) => ch.capability?.built);
  const allPlaceholder = channels.length === 0;

  // Collect all visible fields for this panel
  const allFieldEntries = channels.flatMap((ch) => {
    const entries = getFieldsByChannel(ch.key);
    if (showDebug) return entries;
    return entries.filter(([, meta]) => meta.visibility !== 'debug');
  });

  const fieldCount = allFieldEntries.length;

  // Representative fields (first 4 visible normal fields)
  const repFields = allFieldEntries
    .filter(([, meta]) => meta.visibility === 'normal')
    .slice(0, 4);

  // Debug-only field names
  const debugFieldNames = allFieldEntries
    .filter(([, meta]) => meta.visibility === 'debug')
    .map(([key]) => getFieldMeta(key).label_zh);

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.icon}>{icon}</span>
        <div style={styles.headerText}>
          <div style={styles.title}>{title}</div>
          <div style={styles.desc}>{description}</div>
        </div>
        <div style={styles.statusBadge}>
          {anyBuilt
            ? <span style={styles.builtBadge}>✅ {t('analysis.ready', '已就绪')}</span>
            : <span style={styles.emptyBadge}>⏳ {t('analysis.notBuilt', '尚未构建')}</span>
          }
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
        {allPlaceholder ? (
          /* Placeholder state for future channels */
          <div style={styles.placeholderState}>
            <div style={styles.placeholderIcon}>🔮</div>
            <div style={styles.placeholderTitle}>{t('analysis.comingSoon', '即将推出')}</div>
            <div style={styles.placeholderDesc}>{t('analysis.comingSoon.desc', '此功能正在开发中，敬请期待。')}</div>
          </div>
        ) : (
          channels.map((ch) => {
            const cap = ch.capability;
            const isBuilt = cap?.built ?? false;
            const isBuildable = cap?.buildable ?? false;
            const isBuilding = ch.building;
            const isViewing = activeViewChannel === ch.key;

            return (
              <div key={ch.key} style={styles.channelRow}>
                {/* Left: channel info */}
                <div style={styles.channelInfo}>
                  <div style={styles.channelName}>{ch.key}</div>

                  {isBuilt && fieldCount > 0 && (
                    <div style={styles.fieldSummary}>
                      <span style={styles.fieldCount}>
                        {t('analysis.fieldCount', '{n} 个字段').replace('{n}', String(fieldCount))}
                      </span>
                      {cap && cap.sort_fields.length > 0 && (
                        <span style={styles.fieldMeta}>
                          {' · '}
                          {t('analysis.sortableCount', '{n} 个可排序').replace('{n}', String(cap.sort_fields.length))}
                        </span>
                      )}
                      {cap && cap.filter_fields.length > 0 && (
                        <span style={styles.fieldMeta}>
                          {' · '}
                          {t('analysis.filterableCount', '{n} 个可筛选').replace('{n}', String(cap.filter_fields.length))}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Representative fields */}
                  {isBuilt && repFields.length > 0 && (
                    <div style={styles.repFields}>
                      <span style={{ color: 'var(--text-tertiary, #888)' }}>代表字段：</span>
                      {repFields.map(([key, meta], idx) => (
                        <span key={key}>
                          {idx > 0 && <span style={{ color: 'var(--text-faint, #555)' }}>、</span>}
                          <span
                            style={{
                              color: 'var(--text-secondary, #aaa)',
                              cursor: 'help',
                              borderBottom: '1px dotted var(--border, #2a2a3e)',
                            }}
                            title={`${meta.description_zh}${meta.unit ? ` (${meta.unit})` : ''}`}
                          >
                            {meta.label_zh}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Debug-only field warning */}
                  {isBuilt && debugFieldNames.length > 0 && showDebug && (
                    <div style={styles.debugNotice}>
                      {t('analysis.debugOnlyFields', 'Debug-only：{fields}')
                        .replace('{fields}', debugFieldNames.join('、'))}
                    </div>
                  )}

                  {/* Cluster participation */}
                  {isBuilt && allFieldEntries.length > 0 && (
                    <div style={styles.clusterNote}>
                      {allFieldEntries.some(([, meta]) => meta.cluster_participation)
                        ? '🧬 ' + t('analysis.clusterParticipation', '参与默认聚类')
                        : '📋 ' + t('analysis.notParticipateClustering', '不参与默认聚类')}
                    </div>
                  )}
                </div>

                {/* Right: actions */}
                <div style={styles.actions}>
                  {isBuilding ? (
                    <span style={styles.buildingText}>{t('analysis.buildingAction', '构建中...')}</span>
                  ) : isBuilt ? (
                    <div style={styles.actionGroup}>
                      {cap && cap.sort_fields.length > 0 && (
                        <button
                          style={{ ...styles.actionBtn, ...(isViewing ? styles.actionBtnActive : {}) }}
                          onClick={() => onViewData?.(ch.key)}
                          title={t('analysis.sortAction', '排序')}
                        >
                          📊 {t('analysis.sortAction', '排序')}
                        </button>
                      )}
                      {cap && cap.filter_fields.length > 0 && (
                        <button style={styles.actionBtn} onClick={() => onFilter?.(ch.key)}>
                          🔍 {t('analysis.filterAction', '筛选')}
                        </button>
                      )}
                      {/* Fallback: show a generic view button when no sort/filter fields */}
                      {(!cap || (cap.sort_fields.length === 0 && cap.filter_fields.length === 0)) && (
                        <button
                          style={{ ...styles.actionBtn, ...(isViewing ? styles.actionBtnActive : {}) }}
                          onClick={() => onViewData?.(ch.key)}
                        >
                          👁️ {t('analysis.viewData', '查看数据')}
                        </button>
                      )}
                    </div>
                  ) : isBuildable ? (
                    <button
                      style={styles.buildBtn}
                      onClick={() => onBuild?.(ch.key)}
                    >
                      ⚡ {t('analysis.buildAction', '构建通道')}
                    </button>
                  ) : (
                    <span style={styles.notBuildableText}>
                      {t('analysis.notBuildable', '当前版本暂不开放')}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 16,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '14px 16px',
    background: 'var(--surface-elevated, #1a1a28)',
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  icon: {
    fontSize: 22,
    lineHeight: 1.3,
    flexShrink: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: 'var(--text, #e0e0e8)',
    marginBottom: 2,
  },
  desc: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    lineHeight: 1.4,
  },
  statusBadge: {
    flexShrink: 0,
  },
  builtBadge: {
    fontSize: 11,
    color: 'var(--success, #46f1c5)',
    whiteSpace: 'nowrap',
  },
  emptyBadge: {
    fontSize: 11,
    color: 'var(--warning, #ffd93d)',
    whiteSpace: 'nowrap',
  },
  body: {
    padding: '12px 16px',
  },
  channelRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  channelInfo: {
    flex: 1,
    minWidth: 0,
  },
  channelName: {
    fontSize: 11,
    color: 'var(--text-faint, #555)',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  fieldSummary: {
    fontSize: 12,
    color: 'var(--text-tertiary, #888)',
    marginBottom: 4,
  },
  fieldCount: {
    color: 'var(--accent, #7c9bff)',
    fontWeight: 600,
  },
  fieldMeta: {
    color: 'var(--text-tertiary, #888)',
  },
  repFields: {
    fontSize: 11,
    color: 'var(--text-tertiary, #888)',
    marginBottom: 4,
    lineHeight: 1.5,
  },
  debugNotice: {
    fontSize: 10,
    color: 'var(--warning, #ffd93d)',
    marginBottom: 4,
  },
  clusterNote: {
    fontSize: 10,
    color: 'var(--text-tertiary, #888)',
    marginTop: 2,
  },
  actions: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    alignItems: 'flex-end',
    minWidth: 100,
  },
  actionGroup: {
    display: 'flex',
    gap: 6,
  },
  actionBtn: {
    padding: '5px 10px',
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text-secondary, #aaa)',
    border: '1px solid var(--border-strong, #3a3a55)',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  actionBtnActive: {
    background: 'var(--surface-active, #2a2a48)',
    color: 'var(--accent, #7c9bff)',
    border: '1px solid var(--accent, #7c9bff)',
  },
  buildBtn: {
    padding: '5px 12px',
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--success, #46f1c5)',
    border: '1px solid var(--success, #46f1c5)',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  buildingText: {
    fontSize: 11,
    color: 'var(--warning, #ffd93d)',
    padding: '5px 0',
  },
  notBuildableText: {
    fontSize: 11,
    color: 'var(--text-faint, #555)',
    padding: '5px 0',
  },
  placeholderState: {
    textAlign: 'center',
    padding: '20px 0',
  },
  placeholderIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  placeholderTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-secondary, #aaa)',
    marginBottom: 6,
  },
  placeholderDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary, #888)',
    lineHeight: 1.5,
    maxWidth: 400,
    margin: '0 auto',
  },
};
