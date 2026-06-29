/**
 * DuplicateGroupGallery — 重复图分组画廊 (P10-003)
 *
 * 用缩略图网格展示重复图片组，替代传统的平铺排序表。
 * 保留旧 DuplicateGroupsView 的入口。
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchDuplicateGroups, buildAnalysisChannel, getThumbnailUrl } from '../../api/client';
import type { AnalysisCapability, DuplicateGroup } from '../../api/client';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import ErrorState from '../ui/ErrorState';
import LoadingState from '../ui/LoadingState';

interface DuplicateGroupGalleryProps {
  jobId: string;
  capability: AnalysisCapability | null;
  /** 用户点击"查看原始重复图视图" */
  onSwitchToRawView?: () => void;
}

export default function DuplicateGroupGallery({
  jobId,
  capability,
  onSwitchToRawView,
}: DuplicateGroupGalleryProps) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const isBuilt = capability?.channels?.duplicate_groups?.built ?? false;

  const loadGroups = useCallback(async () => {
    if (!isBuilt) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchDuplicateGroups(jobId);
      setGroups(resp.groups || []);
      setStats(resp.stats);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [jobId, isBuilt]);

  useEffect(() => {
    if (isBuilt) loadGroups();
  }, [isBuilt, loadGroups]);

  if (!isBuilt) {
    return (
      <EmptyState
        icon="📋"
        title="需要先构建重复图检测通道"
        description="构建后可以按组浏览重复图片，查看精确重复和感知相似的图片分组。"
        action={
          <Button
            variant="primary"
            size="sm"
            disabled={building}
            onClick={async () => {
              setBuilding(true);
              try {
                await buildAnalysisChannel(jobId, 'duplicate_groups');
                // Reload capability via parent
                window.location.reload();
              } catch {
                // handled by parent build error
              } finally {
                setBuilding(false);
              }
            }}
          >
            {building ? '构建中…' : '构建通道'}
          </Button>
        }
      />
    );
  }

  if (loading) {
    return <LoadingState text="正在加载重复图组…" />;
  }

  if (error) {
    return (
      <ErrorState
        title="重复图组加载失败"
        message={error}
        onRetry={loadGroups}
      />
    );
  }

  if (groups.length === 0) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>
            重复图检测 — {stats?.total_images_checked ?? 0} 张已检查
          </span>
          {onSwitchToRawView && (
            <Button variant="ghost" size="sm" onClick={onSwitchToRawView}>
              查看原始重复图视图
            </Button>
          )}
        </div>
        <EmptyState
          icon="✅"
          title="未发现重复图片"
          description={stats ? '所有图片均为唯一。' : '暂无数据。'}
        />
      </div>
    );
  }

  const exactCount = groups.filter((g) => g.group_type === 'exact').length;
  const perceptualCount = groups.filter((g) => g.group_type === 'perceptual').length;

  return (
    <div style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerTitle}>
            重复图检测 — {groups.length} 组
          </span>
          <span style={styles.headerStats}>
            {exactCount > 0 && `${exactCount} 组精确重复`}
            {exactCount > 0 && perceptualCount > 0 ? ' · ' : ''}
            {perceptualCount > 0 && `${perceptualCount} 组近似重复`}
          </span>
        </div>
        {onSwitchToRawView && (
          <Button variant="ghost" size="sm" onClick={onSwitchToRawView}>
            查看原始重复图视图
          </Button>
        )}
      </div>

      {/* Group cards */}
      <div style={styles.groupList}>
        {groups.map((group) => (
          <DuplicateGroupCard
            key={group.group_id}
            group={group}
            jobId={jobId}
          />
        ))}
      </div>

      {/* Footer stats */}
      {stats && (
        <div style={styles.footer}>
          共检查 {stats.total_images_checked} 张图片，
          发现 {stats.total_duplicate_images} 张重复图
          ({stats.total_exact_groups} 组精确, {stats.total_perceptual_groups} 组近似)
        </div>
      )}
    </div>
  );
}

/** 单个重复图组卡片 */
function DuplicateGroupCard({
  group,
  jobId,
}: {
  group: DuplicateGroup;
  jobId: string;
}) {
  const [expanded, setExpanded] = useState(true);

  const isExact = group.group_type === 'exact';

  // Show up to 6 member thumbnails in the collapsed preview
  const previewMembers = group.members.slice(0, 6);
  const hasMore = group.members.length > 6;

  return (
    <div style={groupCardStyles.card}>
      {/* Group header */}
      <div
        style={groupCardStyles.header}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={groupCardStyles.badgeRow}>
          <span style={{
            ...groupCardStyles.typeBadge,
            background: isExact ? 'rgba(124,155,255,0.15)' : 'rgba(255,200,80,0.15)',
            color: isExact ? 'var(--accent, #7c9bff)' : '#ffc850',
          }}>
            {isExact ? '📋 精确重复' : '🔗 近似重复'}
          </span>
          <span style={groupCardStyles.count}>{group.image_count} 张</span>
        </div>
        <span style={groupCardStyles.chevron}>{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Gallery */}
      {expanded && (
        <div style={groupCardStyles.gallery}>
          {previewMembers.map((member, idx) => {
            const thumbUrl = getThumbnailUrl(jobId, member.path, 160);
            const shortName = (member.path || '').split(/[\\/]/).pop() || member.path;
            return (
              <div key={member.path || idx} style={groupCardStyles.thumbItem}>
                <div style={groupCardStyles.thumbWrap}>
                  <img
                    src={thumbUrl}
                    alt={shortName}
                    style={groupCardStyles.thumb}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
                <div style={groupCardStyles.thumbName} title={member.path}>
                  {shortName}
                </div>
              </div>
            );
          })}
          {hasMore && (
            <div style={groupCardStyles.moreBadge}>
              +{group.members.length - 6} 张
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════ Styles ═══════════════ */

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 4px 8px',
    borderBottom: '1px solid var(--border, #2a2a3e)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
  },
  headerStats: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
  },
  groupList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  footer: {
    padding: '8px 4px',
    fontSize: 10,
    color: 'var(--text-faint, #555)',
    borderTop: '1px solid var(--border, #2a2a3e)',
  },
};

const groupCardStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 'var(--radius-md, 8px)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  badgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm, 4px)',
    fontSize: 10,
    fontWeight: 600,
  },
  count: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
  },
  chevron: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
  },
  gallery: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: 6,
    padding: '0 10px 10px',
  },
  thumbItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: '4 / 3',
    overflow: 'hidden',
    borderRadius: 'var(--radius-sm, 4px)',
    background: 'var(--thumbnail-bg, #1a1a28)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  thumbName: {
    fontSize: 9,
    color: 'var(--text-faint, #555)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  },
  moreBadge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    color: 'var(--text-muted, #888)',
    background: 'var(--surface, #1e1e2e)',
    border: '1px dashed var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    aspectRatio: '4 / 3',
  },
};
