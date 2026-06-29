/**
 * AnalysisChannelCards — 分析通道选择步骤
 *
 * P09-006: 已可用通道和扩展能力分离。
 * 基础信息/曝光色彩/质量边缘为主卡片，重复图/模型分析归入"扩展能力"折叠区。
 */

interface ChannelDef {
  key: string;
  label_zh: string;
  description_zh: string;
  features_zh: string;
}

/** Main channels (backend-ready) */
const MAIN_CHANNELS: ChannelDef[] = [
  {
    key: 'basic_metadata',
    label_zh: '基础信息',
    description_zh: '图片文件的基础属性',
    features_zh: '分辨率 · 比例 · 文件体积 · 透明图 · 过曝/死黑',
  },
  {
    key: 'histogram',
    label_zh: '曝光色彩',
    description_zh: '亮度分布、饱和度和色温分析',
    features_zh: '低调 · 高调 · 对比 · 冷暖 · 饱和度 · 直方图异常',
  },
  {
    key: 'quality_edge',
    label_zh: '质量边缘',
    description_zh: '清晰度、边缘密度和风格评估',
    features_zh: '模糊 · 锐度 · 边缘 · 线稿候选 · 平涂风格',
  },
  {
    key: 'duplicate_groups',
    label_zh: '重复图检测',
    description_zh: '查找完全一致和感知相似的重复图片',
    features_zh: '精确重复 · 近似重复 · 哈希比对',
  },
];

/** Extension channels (not yet backend-ready) */
const EXT_CHANNELS: ChannelDef[] = [
  {
    key: 'duplicate_groups',
    label_zh: '重复图检测',
    description_zh: '查找完全一致和感知相似的重复图片',
    features_zh: '精确重复 · 近似重复 · 哈希比对',
  },
  {
    key: 'model_plugins',
    label_zh: '可选模型分析',
    description_zh: '接入离线模型进行标签/风格/检测分析',
    features_zh: 'WD14 等离线标签模型',
  },
];

interface AnalysisChannelCardsProps {
  channels: Record<string, boolean>;
  onChange: (key: string, value: boolean) => void;
  disabled?: boolean;
}

export default function AnalysisChannelCards({
  channels, onChange, disabled,
}: AnalysisChannelCardsProps) {
  return (
    <div style={styles.card}>
      {/* Step header */}
      <div style={styles.stepHeader}>
        <span style={styles.stepNum}>4</span>
        <div>
          <div style={styles.stepTitle}>分析通道</div>
          <div style={styles.stepDesc}>可选分析能力，仅用于排序筛选，不影响聚类</div>
        </div>
      </div>

      {/* Main channels */}
      <div style={styles.channelList}>
        {MAIN_CHANNELS.map((ch) => {
          const isChecked = channels[ch.key] ?? true;
          return (
            <button
              key={ch.key}
              onClick={() => {
                if (!disabled) onChange(ch.key, !isChecked);
              }}
              disabled={disabled}
              style={{
                ...styles.channelCard,
                ...(isChecked && !disabled ? styles.channelChecked : {}),
                ...(disabled ? styles.channelDisabled : {}),
              }}
            >
              <div style={styles.channelTop}>
                <div style={styles.chkWrap}>
                  <span style={{
                    ...styles.chkBox,
                    background: isChecked ? 'var(--accent, #7c9bff)' : 'transparent',
                    borderColor: isChecked ? 'var(--accent, #7c9bff)' : 'var(--border, #2a2a3e)',
                  }}>
                    {isChecked && <span style={styles.chkMark}>✓</span>}
                  </span>
                </div>
                <div style={styles.channelInfo}>
                  <div style={styles.channelName}>{ch.label_zh}</div>
                  <div style={styles.channelDesc}>{ch.description_zh}</div>
                  <div style={styles.channelFeatures}>{ch.features_zh}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Extension section */}
      <div style={styles.extSection}>
        <div style={styles.extTitle}>扩展能力</div>
        <div style={styles.extIntro}>
          以下通道将在后续版本开放。勾选后不会影响当前分析，但会在构建阶段跳过。
        </div>
        {EXT_CHANNELS.filter((ch) => ch.key !== 'duplicate_groups').map((ch) => {
          const isChecked = channels[ch.key] ?? false;
          return (
            <label key={ch.key} style={styles.extRow}>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onChange(ch.key, !isChecked)}
                disabled={disabled}
                style={{ accentColor: 'var(--accent, #7c9bff)' }}
              />
              <div style={styles.extInfo}>
                <span style={styles.extName}>{ch.label_zh}</span>
                <span style={styles.extDesc}>{ch.description_zh}</span>
              </div>
            </label>
          );
        })}
      </div>

      {/* Strategy note */}
      <div style={styles.strategyNote}>
        构建策略：聚类运行完成后，根据勾选依次构建分析通道。仅用于排序、筛选和审查，不参与默认聚类。
      </div>
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
  stepHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
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
    marginTop: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
  },
  stepDesc: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    marginTop: 1,
  },
  channelList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 12,
  },
  channelCard: {
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 12px',
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
    transition: 'all 0.12s',
    width: '100%',
  },
  channelChecked: {
    background: 'var(--chip-active-bg, rgba(124,155,255,0.08))',
    borderColor: 'var(--accent, #7c9bff)',
  },
  channelDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  channelTop: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  chkWrap: {
    flexShrink: 0,
    marginTop: 1,
  },
  chkBox: {
    display: 'inline-flex',
    width: 16,
    height: 16,
    borderRadius: 3,
    border: '1px solid',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 700,
    color: '#fff',
    transition: 'all 0.1s',
  },
  chkMark: {
    lineHeight: 1,
  },
  channelInfo: {
    flex: 1,
    minWidth: 0,
  },
  channelName: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
    marginBottom: 1,
  },
  channelDesc: {
    fontSize: 10,
    color: 'var(--text-muted, #888)',
    marginBottom: 2,
  },
  channelFeatures: {
    fontSize: 10,
    color: 'var(--text-secondary, #aaa)',
    lineHeight: 1.4,
  },
  extSection: {
    marginBottom: 10,
    padding: '8px 10px',
    background: 'var(--bg, #12121a)',
    borderRadius: 6,
    border: '1px solid var(--border, #2a2a3e)',
  },
  extTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-faint, #555)',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  extIntro: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
    marginBottom: 6,
    lineHeight: 1.4,
    fontStyle: 'italic',
  },
  extRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 0',
    cursor: 'pointer',
    fontSize: 12,
  },
  extInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    flex: 1,
  },
  extName: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    fontWeight: 600,
  },
  extDesc: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
  },
  strategyNote: {
    fontSize: 10,
    color: 'var(--text-muted, #888)',
    lineHeight: 1.5,
    padding: '6px 8px',
    background: 'var(--bg, #12121a)',
    borderRadius: 4,
    border: '1px solid var(--border, #2a2a3e)',
  },
};
