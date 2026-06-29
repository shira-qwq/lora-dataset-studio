/**
 * InspectionSliceBar — 图片巡检切片栏
 *
 * 按组分组的切片 chip 导航栏。
 * 读取 inspectionManifest 中的预设定义，不硬编码切片列表。
 */
import { useState, useMemo } from 'react';
import {
  resolvePresetsByGroup,
  checkSliceAvailability,
  SLICE_GROUPS,
} from '../../analysis/inspectionManifest';
import type { ResolvedPreset } from '../../analysis/inspectionManifest';
import type { SliceGroup } from '../../analysis/inspectionPresets';
import type { AnalysisCapability } from '../../api/client';

interface InspectionSliceBarProps {
  /** Current selected slice ID */
  activeSlice: string;
  /** Called when user selects a slice */
  onSelectSlice: (sliceId: string) => void;
  /** Current analysis capability (for availability check) */
  capability: AnalysisCapability | null;
  /** Optional: filter to specific groups */
  groups?: SliceGroup[];
}

export default function InspectionSliceBar({
  activeSlice,
  onSelectSlice,
  capability,
  groups,
}: InspectionSliceBarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['plugin', 'advanced', 'file_more']));

  // Resolve presets, grouped
  const groupedPresets = useMemo(() => {
    const allGroups = SLICE_GROUPS.filter((g) => {
      if (groups) return groups.includes(g.id);
      return g.id !== 'plugin' && g.id !== 'advanced';
    });

    return allGroups.map((group) => {
      let presets: ResolvedPreset[];
      if (group.id === 'all') {
        presets = resolvePresetsByGroup('all');
      } else {
        presets = resolvePresetsByGroup(group.id);
      }
      // Attach availability
      presets = presets.map((p) => ({
        ...p,
        _available: p.id === 'all' ? true : checkSliceAvailability(p, capability).available,
      })) as (ResolvedPreset & { _available: boolean })[];

      return { group, presets: presets as (ResolvedPreset & { _available: boolean })[] };
    }).filter((g) => g.presets.length > 0);
  }, [capability, groups]);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div style={styles.bar}>
      {groupedPresets.map(({ group, presets }) => {
        const isCollapsed = collapsedGroups.has(group.id);
        const isPrimary = group.id === 'all' || group.id === 'brightness' || group.id === 'color';
        const isFileGroup = group.id === 'file';
        const mainFilePresets = presets.filter((preset) => ['large_image', 'small_image'].includes(preset.id));
        const moreFilePresets = presets.filter((preset) => !['large_image', 'small_image'].includes(preset.id));

        if (isFileGroup) {
          const moreCollapsed = collapsedGroups.has('file_more');
          return (
            <div key={group.id} style={styles.group}>
              <button
                onClick={() => toggleGroup(group.id)}
                style={styles.groupToggle}
                title={isCollapsed ? '展开尺寸风险' : '折叠尺寸风险'}
              >
                <span style={styles.groupLabel}>尺寸风险</span>
                <span style={styles.groupChevron}>{isCollapsed ? '▸' : '▾'}</span>
              </button>

              <div style={{ ...styles.chipRow, flexWrap: 'wrap' as const }}>
                {!isCollapsed && mainFilePresets.map((preset: any) => {
                  const isActive = activeSlice === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => onSelectSlice(preset.id)}
                      title={preset.copy.description_zh || preset.copy.label_zh}
                      style={{
                        ...styles.chip,
                        ...(isActive ? styles.chipActive : {}),
                        ...(!preset._available ? styles.chipDisabled : {}),
                      }}
                    >
                      {preset.copy.label_zh}
                    </button>
                  );
                })}
              </div>

              {moreFilePresets.length > 0 && !isCollapsed && (
                <div style={styles.moreGroup}>
                  <button
                    onClick={() => toggleGroup('file_more')}
                    style={styles.groupToggle}
                    title={moreCollapsed ? '展开更多信息' : '折叠更多信息'}
                  >
                    <span style={styles.groupLabel}>更多信息</span>
                    <span style={styles.groupChevron}>{moreCollapsed ? '▸' : '▾'}</span>
                  </button>
                  {!moreCollapsed && (
                    <div style={{ ...styles.chipRow, flexWrap: 'wrap' as const }}>
                      {moreFilePresets.map((preset: any) => {
                        const isActive = activeSlice === preset.id;
                        return (
                          <button
                            key={preset.id}
                            onClick={() => onSelectSlice(preset.id)}
                            title={preset.copy.description_zh || preset.copy.label_zh}
                            style={{
                              ...styles.chip,
                              ...styles.chipSecondary,
                              ...(isActive ? styles.chipActive : {}),
                              ...(!preset._available ? styles.chipDisabled : {}),
                            }}
                          >
                            {preset.copy.label_zh}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        }

        return (
          <div key={group.id} style={styles.group}>
            {group.id !== 'all' && (
              <button
                onClick={() => toggleGroup(group.id)}
                style={styles.groupToggle}
                title={isCollapsed ? `展开${group.label_zh}` : `折叠${group.label_zh}`}
              >
                <span style={styles.groupLabel}>{group.label_zh}</span>
                <span style={styles.groupChevron}>{isCollapsed ? '▸' : '▾'}</span>
              </button>
            )}

            <div
              style={{
                ...styles.chipRow,
                ...(isPrimary ? {} : { flexWrap: 'wrap' as const }),
              }}
            >
              {!isCollapsed && presets.map((preset: any) => {
                const isActive = activeSlice === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => onSelectSlice(preset.id)}
                    title={preset.copy.description_zh || preset.copy.label_zh}
                    style={{
                      ...styles.chip,
                      ...(isActive ? styles.chipActive : {}),
                      ...(!preset._available ? styles.chipDisabled : {}),
                    }}
                  >
                    {preset.copy.label_zh}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 12,
    padding: '8px 0',
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  groupToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 4px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: 'var(--text-muted, #888)',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    width: 'fit-content',
  },
  groupLabel: {
    color: 'var(--text-faint, #555)',
  },
  groupChevron: {
    fontSize: 8,
    color: 'var(--text-faint, #555)',
  },
  chipRow: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    paddingLeft: 4,
  },
  chip: {
    padding: '4px 10px',
    borderRadius: 'var(--radius-sm, 4px)',
    fontSize: 11,
    fontWeight: 500,
    border: '1px solid var(--chip-border, #2a2a3e)',
    background: 'var(--chip-bg, #262640)',
    color: 'var(--text, #e0e0e8)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    transition: 'all 0.1s',
    lineHeight: 1.3,
  },
  chipActive: {
    background: 'var(--chip-active-bg, rgba(124,155,255,0.15))',
    borderColor: 'var(--chip-active-border, #7c9bff)',
    color: 'var(--accent, #7c9bff)',
    fontWeight: 600,
  },
  chipDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    textDecoration: 'line-through',
  },
  chipSecondary: {
    opacity: 0.78,
    background: 'var(--surface, #1e1e2e)',
  },
  moreGroup: {
    marginTop: 4,
    paddingLeft: 10,
    borderLeft: '1px dashed var(--border, #2a2a3e)',
  },
};
