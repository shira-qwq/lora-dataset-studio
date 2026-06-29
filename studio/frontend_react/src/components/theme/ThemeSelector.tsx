/**
 * ThemeSelector — 右上角完整主题面板
 *
 * P09-002: Presets / Custom / Reset.
 * - Presets: 4 个预设主题圆点
 * - Custom: 主色、背景深浅、面板对比、边框强度、圆角、密度
 * - Reset: 恢复默认主题
 * - 所有自定义配置持久化到 localStorage，刷新后保留
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { THEME_META } from '../../theme/themes';
import { applyTheme, getStoredTheme } from '../../theme/applyTheme';
import {
  getStoredCustomConfig,
  saveCustomConfig,
  applyCustomTheme,
  clearCustomTheme,
  resetCustomTheme,
  isCustomActive,
  setCustomActive,
} from '../../theme/customTheme';
import type { ThemeId } from '../../theme/tokens';
import type { CustomThemeConfig, DensityMode } from '../../theme/themeConfig';

/* ─── Slider helper ─── */
function Slider({
  label, value, min, max, step, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={sliderStyles.row}>
      <span style={sliderStyles.label}>{label}</span>
      <div style={sliderStyles.trackWrap}>
        <div style={sliderStyles.trackBg}>
          <div
            style={{
              ...sliderStyles.trackFill,
              width: `${((value - min) / (max - min)) * 100}%`,
            }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={sliderStyles.range}
        />
      </div>
      <span style={sliderStyles.value}>{value}</span>
    </div>
  );
}

/* ─── Density button group ─── */
const DENSITY_OPTIONS: { key: DensityMode; label: string }[] = [
  { key: 'compact', label: '紧凑' },
  { key: 'standard', label: '标准' },
  { key: 'comfortable', label: '宽松' },
];

export default function ThemeSelector() {
  const [current, setCurrent] = useState<ThemeId>(getStoredTheme());
  const [isCustom, setIsCustom] = useState(isCustomActive());
  const [panelOpen, setPanelOpen] = useState(false);
  const [customConfig, setCustomConfig] = useState<CustomThemeConfig>(getStoredCustomConfig());
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击面板外部关闭
  useEffect(() => {
    if (!panelOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [panelOpen]);

  const handleCustomToggle = useCallback(() => {
    if (isCustom) {
      // 关闭自定义：恢复到当前 preset
      setCustomActive(false);
      clearCustomTheme();
      const stored = getStoredTheme();
      applyTheme(stored);
      setCurrent(stored);
      setIsCustom(false);
    } else {
      // 开启自定义
      applyTheme('custom');
      setCurrent('custom' as ThemeId);
      setIsCustom(true);
    }
  }, [isCustom]);

  const handleCustomChange = useCallback(<K extends keyof CustomThemeConfig>(
    key: K, value: CustomThemeConfig[K],
  ) => {
    const updated = { ...customConfig, [key]: value };
    setCustomConfig(updated);
    saveCustomConfig(updated);
    applyCustomTheme(updated);
  }, [customConfig]);

  const handleReset = useCallback(() => {
    resetCustomTheme();
    setIsCustom(false);
    const stored = getStoredTheme();
    setCurrent(stored);
    applyTheme(stored);
  }, []);

  // 更新预设但保留自定义面板状态
  const handlePresetSelect = useCallback((themeId: ThemeId) => {
    if (isCustom) {
      // 如果当前在自定义模式，点击预设 = 切换到预设
      setCustomActive(false);
      clearCustomTheme();
    }
    applyTheme(themeId);
    setCurrent(themeId);
    setIsCustom(false);
  }, [isCustom]);

  return (
    <div ref={panelRef} style={styles.wrapper}>
      {/* 触发按钮 */}
      <button
        onClick={() => setPanelOpen((p) => !p)}
        style={styles.trigger}
        title="切换主题"
      >
        <span
          style={{
            ...styles.currentDot,
            background: isCustom
              ? customConfig.accent
              : THEME_META.find((t) => t.id === current)?.accent || '#7c9bff',
          }}
        />
        <span style={styles.triggerLabel}>
          {isCustom ? '自定义' : THEME_META.find((t) => t.id === current)?.labelCn || '主题'}
        </span>
        <span style={styles.chevron}>{panelOpen ? '▲' : '▼'}</span>
      </button>

      {/* 面板 */}
      {panelOpen && (
        <div style={styles.panel}>
          {/* Presets */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>预设主题</div>
            <div style={styles.presetRow}>
              {THEME_META.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handlePresetSelect(t.id)}
                  title={`${t.labelCn} — ${t.description}`}
                  style={{
                    ...styles.presetDot,
                    backgroundColor: t.accent,
                    outline: !isCustom && current === t.id
                      ? '2px solid var(--accent, #7c9bff)'
                      : 'none',
                    outlineOffset: 2,
                    opacity: !isCustom && current === t.id ? 1 : 0.5,
                  }}
                  aria-label={t.labelCn}
                />
              ))}
            </div>
          </div>

          {/* Custom toggle */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>自定义</div>
            <button
              onClick={handleCustomToggle}
              style={{
                ...styles.toggleBtn,
                background: isCustom ? 'var(--accent, #7c9bff)' : 'var(--surface, #1e1e2e)',
                color: isCustom ? '#fff' : 'var(--text, #e0e0e8)',
              }}
            >
              {isCustom ? '✓ 自定义已启用' : '开启自定义'}
            </button>
          </div>

          {/* Custom controls (only when custom is active) */}
          {isCustom && (
            <div style={styles.section}>
              {/* Accent color */}
              <div style={sliderStyles.row}>
                <span style={sliderStyles.label}>主色</span>
                <input
                  type="color"
                  value={customConfig.accent}
                  onChange={(e) => handleCustomChange('accent', e.target.value)}
                  style={styles.colorInput}
                />
                <span style={sliderStyles.value}>{customConfig.accent}</span>
              </div>

              <Slider
                label="背景深浅"
                value={customConfig.backgroundTone}
                min={0}
                max={100}
                onChange={(v) => handleCustomChange('backgroundTone', v)}
              />
              <Slider
                label="面板对比"
                value={customConfig.surfaceContrast}
                min={0}
                max={100}
                onChange={(v) => handleCustomChange('surfaceContrast', v)}
              />
              <Slider
                label="边框强度"
                value={customConfig.borderStrength}
                min={0}
                max={100}
                onChange={(v) => handleCustomChange('borderStrength', v)}
              />
              <Slider
                label="圆角"
                value={customConfig.radius}
                min={0}
                max={100}
                onChange={(v) => handleCustomChange('radius', v)}
              />

              {/* Density */}
              <div style={sliderStyles.row}>
                <span style={sliderStyles.label}>密度</span>
                <div style={densityStyles.group}>
                  {DENSITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => handleCustomChange('density', opt.key)}
                      style={{
                        ...densityStyles.btn,
                        background: customConfig.density === opt.key
                          ? 'var(--accent, #7c9bff)'
                          : 'var(--surface, #1e1e2e)',
                        color: customConfig.density === opt.key
                          ? '#fff'
                          : 'var(--text, #e0e0e8)',
                        borderColor: customConfig.density === opt.key
                          ? 'var(--accent, #7c9bff)'
                          : 'var(--border, #2a2a3e)',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Reset */}
          <div style={styles.section}>
            <button onClick={handleReset} style={styles.resetBtn}>
              重置主题
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════ Styles ═══════════════════════════ */
const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
  },
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: 'var(--text, #e0e0e8)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    whiteSpace: 'nowrap',
    transition: 'border-color 0.12s',
  },
  currentDot: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  triggerLabel: {
    fontWeight: 500,
  },
  chevron: {
    fontSize: 8,
    color: 'var(--text-muted, #888)',
  },
  panel: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    right: 0,
    width: 260,
    background: 'var(--bg-elevated, #1a1a28)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-md, 8px)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    padding: 12,
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  section: {
    paddingBottom: 8,
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted, #888)',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  presetRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  presetDot: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.15s, outline 0.15s',
    padding: 0,
  },
  toggleBtn: {
    width: '100%',
    padding: '6px 0',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    transition: 'all 0.12s',
  },
  colorInput: {
    width: 32,
    height: 24,
    padding: 0,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    background: 'transparent',
  },
  resetBtn: {
    width: '100%',
    padding: '6px 0',
    background: 'transparent',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: 'var(--danger, #ff5a6e)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    transition: 'all 0.12s',
  },
};

const sliderStyles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  label: {
    fontSize: 11,
    color: 'var(--text, #e0e0e8)',
    width: 64,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  trackWrap: {
    flex: 1,
    position: 'relative',
    height: 20,
    display: 'flex',
    alignItems: 'center',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    background: 'var(--border, #2a2a3e)',
    borderRadius: 2,
  },
  trackFill: {
    height: '100%',
    background: 'var(--accent, #7c9bff)',
    borderRadius: 2,
    transition: 'width 0.1s',
  },
  range: {
    position: 'relative',
    width: '100%',
    height: 20,
    margin: 0,
    padding: 0,
    background: 'transparent',
    WebkitAppearance: 'none' as any,
    appearance: 'none' as any,
    cursor: 'pointer',
    zIndex: 1,
    opacity: 0,
  },
  value: {
    fontSize: 10,
    color: 'var(--text-muted, #888)',
    width: 24,
    textAlign: 'right' as const,
    flexShrink: 0,
  },
};

const densityStyles: Record<string, React.CSSProperties> = {
  group: {
    display: 'flex',
    gap: 4,
    flex: 1,
  },
  btn: {
    flex: 1,
    padding: '4px 0',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 10,
    fontWeight: 500,
    transition: 'all 0.12s',
  },
};
