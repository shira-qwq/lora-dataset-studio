/**
 * PluginPanel — 可选模型分析面板组件 (P05-003)
 *
 * 展示 optional plugin 的安装状态、资源要求、可用性和降级说明。
 * 复用 ChannelPanel 的视觉风格，但数据来源为 plugin_channels manifest。
 *
 * P09-002: 所有颜色通过 CSS 变量定义，主题自适应。
 */

import type { PluginChannelInfo } from '../api/client';
import { t } from '../i18n/uiDictionary';

interface PluginPanelProps {
  plugins: Record<string, PluginChannelInfo> | undefined;
}

export default function PluginPanel({ plugins }: PluginPanelProps) {
  const entries = Object.entries(plugins ?? {});
  const hasPlugins = entries.length > 0;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.icon}>🧠</span>
        <div style={styles.headerText}>
          <div style={styles.title}>{t('plugin.title', '可选模型分析')}</div>
          <div style={styles.desc}>{t('plugin.title.desc', '接入第三方模型进行标签/检测/风格分析（可选，不影响主流程）')}</div>
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
        {!hasPlugins ? (
          /* Fallback: no plugins registered */
          <div style={styles.placeholder}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔮</div>
            <div style={styles.placeholderTitle}>{t('analysis.comingSoon', '即将推出')}</div>
            <div style={styles.placeholderDesc}>{t('analysis.comingSoon.desc', '此功能正在开发中，敬请期待。')}</div>
          </div>
        ) : (
          entries.map(([pluginId, info]) => (
            <div key={pluginId} style={styles.pluginRow}>
              {/* Left: info */}
              <div style={styles.pluginInfo}>
                <div style={styles.pluginName}>
                  {info.name_zh || pluginId}
                  {info.installed
                    ? <span style={styles.installedBadge}>{t('plugin.installed', '✅ 已安装')}</span>
                    : <span style={styles.notInstalledBadge}>{t('plugin.notInstalled', '❌ 未安装')}</span>
                  }
                </div>

                {/* Description */}
                <div style={styles.pluginDesc}>{info.description_zh}</div>

                {/* Resource tags */}
                <div style={styles.tagRow}>
                  {info.version && (
                    <span style={styles.tag}>
                      {t('plugin.version', '版本 {ver}').replace('{ver}', info.version)}
                    </span>
                  )}
                  <span style={{
                    ...styles.tag,
                    background: info.requires_gpu ? 'rgba(255,90,110,0.1)' : 'rgba(70,241,197,0.1)',
                    color: info.requires_gpu ? 'var(--danger, #ff5a6e)' : 'var(--success, #46f1c5)',
                    border: info.requires_gpu ? '1px solid rgba(255,90,110,0.2)' : '1px solid rgba(70,241,197,0.2)',
                  }}>
                    {info.requires_gpu ? t('plugin.requiresGpu', '需要 GPU') : t('plugin.noGpu', 'CPU 可用')}
                  </span>
                  <span style={{
                    ...styles.tag,
                    background: info.offline_supported ? 'rgba(70,241,197,0.1)' : 'rgba(255,90,110,0.1)',
                    color: info.offline_supported ? 'var(--success, #46f1c5)' : 'var(--danger, #ff5a6e)',
                    border: info.offline_supported ? '1px solid rgba(70,241,197,0.2)' : '1px solid rgba(255,90,110,0.2)',
                  }}>
                    {info.offline_supported ? t('plugin.offlineSupported', '支持离线') : t('plugin.offlineNotSupported', '需要联网')}
                  </span>
                  {info.model_size_mb != null && (
                    <span style={styles.tag}>
                      {t('plugin.modelSize', '模型体积：{size} MB').replace('{size}', String(info.model_size_mb))}
                    </span>
                  )}
                  <span style={styles.tag}>
                    {t('plugin.failureMode', '降级策略：{mode}')
                      .replace('{mode}', info.failure_mode === 'skip'
                        ? t('plugin.failureMode.skip', '跳过')
                        : info.failure_mode)}
                  </span>
                </div>

                {/* Buildable note */}
                {info.buildable_note && (
                  <div style={{
                    ...styles.note,
                    color: info.buildable ? 'var(--success, #46f1c5)' : 'var(--warning, #ffd93d)',
                  }}>
                    {info.buildable_note}
                  </div>
                )}
              </div>

              {/* Right: status */}
              <div style={styles.pluginStatus}>
                {info.available
                  ? <span style={styles.availBadge}>{t('plugin.available', '✅ 可用')}</span>
                  : <span style={styles.notAvailBadge}>{t('plugin.notAvailable', '⏳ 不可用')}</span>
                }
                {!info.installed && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted, #888)', marginTop: 4, textAlign: 'right' }}>
                    {t('plugin.notAffectMain', '可选，不影响主流程')}
                  </div>
                )}
              </div>
            </div>
          ))
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
  body: {
    padding: '12px 16px',
  },
  placeholder: {
    textAlign: 'center',
    padding: '20px 0',
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
  pluginRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
  },
  pluginInfo: {
    flex: 1,
    minWidth: 0,
  },
  pluginName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
    marginBottom: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  installedBadge: {
    fontSize: 10,
    color: 'var(--success, #46f1c5)',
    fontWeight: 400,
  },
  notInstalledBadge: {
    fontSize: 10,
    color: 'var(--danger, #ff5a6e)',
    fontWeight: 400,
  },
  pluginDesc: {
    fontSize: 11,
    color: 'var(--text-tertiary, #888)',
    marginBottom: 8,
    lineHeight: 1.5,
  },
  tagRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  tag: {
    padding: '2px 8px',
    borderRadius: 3,
    fontSize: 10,
    background: 'var(--surface, #1e1e2e)',
    color: 'var(--text-muted, #888)',
    border: '1px solid var(--border, #2a2a3e)',
  },
  note: {
    fontSize: 11,
    lineHeight: 1.4,
    marginTop: 4,
  },
  pluginStatus: {
    flexShrink: 0,
    textAlign: 'right',
  },
  availBadge: {
    fontSize: 11,
    color: 'var(--success, #46f1c5)',
    whiteSpace: 'nowrap',
  },
  notAvailBadge: {
    fontSize: 11,
    color: 'var(--warning, #ffd93d)',
    whiteSpace: 'nowrap',
  },
};
