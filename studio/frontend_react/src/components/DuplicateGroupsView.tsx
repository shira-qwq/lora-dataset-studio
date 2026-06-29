/**
 * DuplicateGroupsView — 重复图组浏览与审核组件 (P05-002)
 *
 * 展示 exact duplicate 和 perceptual near-duplicate 分组，
 * 提供 keep / mark / move 三种审核操作。
 * 不自动删图，所有操作都是逻辑标记。
 */

import { useState, useEffect, useCallback } from 'react';
import type { DuplicateGroup } from '../api/client';
import {
  fetchDuplicateGroups,
  buildDuplicateGroups,
  reviewDuplicateGroup,
} from '../api/client';
import { t } from '../i18n/uiDictionary';

interface DuplicateGroupsViewProps {
  jobId: string;
  isBuilt: boolean;
  onClose?: () => void;
}

type FilterType = 'all' | 'exact' | 'perceptual';

/** Human-readable labels for algorithms. */
const ALGO_LABELS: Record<string, string> = {
  phash: t('duplicate.algorithm.phash', '感知哈希 (phash)'),
  dhash: t('duplicate.algorithm.dhash', '差异哈希 (dhash)'),
  whash: t('duplicate.algorithm.whash', '小波哈希 (whash)'),
  colorhash: t('duplicate.algorithm.colorhash', '色彩哈希 (colorhash)'),
  file_size: t('duplicate.algorithm.file_size', '文件大小'),
  sha256: t('duplicate.algorithm.sha256', 'SHA-256'),
  blake3: t('duplicate.algorithm.blake3', 'BLAKE2b/3'),
};

export default function DuplicateGroupsView({
  jobId,
  isBuilt,
  onClose,
}: DuplicateGroupsViewProps) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [stats, setStats] = useState<{ total_exact_groups: number; total_perceptual_groups: number; total_duplicate_images: number; total_images_checked: number } | null>(null);
  const [buildInfo, setBuildInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    if (!isBuilt) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchDuplicateGroups(jobId);
      setGroups(resp.groups || []);
      setStats(resp.stats);
      setBuildInfo(resp.build_info);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [jobId, isBuilt]);

  useEffect(() => {
    if (isBuilt) loadGroups();
  }, [isBuilt, loadGroups]);

  const handleBuild = async () => {
    setBuilding(true);
    setError(null);
    try {
      const resp = await buildDuplicateGroups(jobId);
      setBuildInfo(resp);
      await loadGroups();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBuilding(false);
    }
  };

  const handleReview = async (groupId: string, action: 'keep' | 'mark' | 'move') => {
    setReviewingId(groupId);
    try {
      await reviewDuplicateGroup(jobId, groupId, action);
      // Update local state
      setGroups((prev) =>
        prev.map((g) =>
          g.group_id === groupId
            ? { ...g, review: { action, note: '', updated_at: new Date().toISOString() } }
            : g,
        ),
      );
    } catch (e: any) {
      setError(`审核失败: ${e.message}`);
    } finally {
      setReviewingId(null);
    }
  };

  // Filter groups
  const filteredGroups = groups.filter((g) => {
    if (filterType === 'all') return true;
    return g.group_type === filterType;
  });

  const exactCount = groups.filter((g) => g.group_type === 'exact').length;
  const perceptualCount = groups.filter((g) => g.group_type === 'perceptual').length;

  if (!isBuilt) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.headerTitle}>{t('duplicate.title', '重复图组')}</span>
          </div>
          {onClose && (
            <button style={styles.closeBtn} onClick={onClose}>✕ {t('common.close', '关闭')}</button>
          )}
        </div>
        <div style={styles.emptyState}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
          <div style={styles.emptyTitle}>{t('analysis.notBuilt', '尚未构建')}</div>
          <div style={styles.emptyDesc}>
            {t('duplicate.build', '构建重复图检测')} — 使用 SHA-256、BLAKE2b 和 4 种感知哈希算法检测完全重复和近似重复图片。
          </div>
          <button
            style={{ ...styles.buildBtn, opacity: building ? 0.6 : 1 }}
            onClick={handleBuild}
            disabled={building}
          >
            {building ? '⏳ ' + t('duplicate.building', '哈希计算中...') : '⚡ ' + t('duplicate.build', '构建重复图检测')}
          </button>
          {error && <div style={styles.errorText}>{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerTitle}>{t('duplicate.title', '重复图组')}</span>
          {stats && (
            <span style={styles.headerMeta}>
              {stats.total_duplicate_images} {t('duplicate.imageCount', '{n} 张重复图片').replace('{n}', String(stats.total_duplicate_images))}
              {' · '}
              {stats.total_exact_groups + stats.total_perceptual_groups} {t('duplicate.groupCount', '{n} 个重复组').replace('{n}', String(stats.total_exact_groups + stats.total_perceptual_groups))}
              {' · '}
              {t('duplicate.totalChecked', '已检查 {n} 张图片').replace('{n}', String(stats.total_images_checked))}
            </span>
          )}
        </div>
        <div style={styles.headerRight}>
          {buildInfo?.blake3_note && (
            <span style={styles.blake3Note} title={buildInfo.blake3_note}>
              {buildInfo.blake3_available ? '✅ BLAKE3' : '⚡ BLAKE2b'}
            </span>
          )}
          {onClose && (
            <button style={styles.closeBtn} onClick={onClose}>✕ {t('common.close', '关闭')}</button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div style={styles.filterBar}>
        <button
          style={{ ...styles.filterBtn, ...(filterType === 'all' ? styles.filterBtnActive : {}) }}
          onClick={() => setFilterType('all')}
        >
          {t('duplicate.filter.all', '全部重复组')} ({exactCount + perceptualCount})
        </button>
        <button
          style={{ ...styles.filterBtn, ...(filterType === 'exact' ? styles.filterBtnActive : {}) }}
          onClick={() => setFilterType('exact')}
        >
          📋 {t('duplicate.exactGroup', '完全重复')} ({exactCount})
        </button>
        <button
          style={{ ...styles.filterBtn, ...(filterType === 'perceptual' ? styles.filterBtnActive : {}) }}
          onClick={() => setFilterType('perceptual')}
        >
          🔗 {t('duplicate.perceptualGroup', '近似重复')} ({perceptualCount})
        </button>
      </div>

      {/* Content */}
      {loading && <div style={styles.statusText}>{t('common.loading', '加载中...')}</div>}
      {error && <div style={styles.errorText}>{t('common.error', '错误')}: {error}</div>}

      {!loading && !error && filteredGroups.length === 0 && (
        <div style={styles.emptyState}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={styles.emptyTitle}>{t('duplicate.noGroups', '未发现重复图片')}</div>
          <div style={styles.emptyDesc}>{t('duplicate.noGroups.desc', '所有图片均为唯一')}</div>
        </div>
      )}

      {!loading && filteredGroups.map((group) => (
        <div key={group.group_id} style={styles.groupCard}>
          {/* Group header */}
          <div
            style={styles.groupHeader}
            onClick={() => setExpandedGroup(expandedGroup === group.group_id ? null : group.group_id)}
          >
            <div style={styles.groupBadge}>
              {group.group_type === 'exact' ? '📋' : '🔗'}
            </div>
            <div style={styles.groupInfo}>
              <div style={styles.groupId}>{group.group_id}</div>
              <div style={styles.groupMeta}>
                <span style={group.group_type === 'exact' ? styles.exactTag : styles.perceptualTag}>
                  {group.group_type === 'exact'
                    ? t('duplicate.exactGroup', '完全重复')
                    : t('duplicate.perceptualGroup', '近似重复')}
                </span>
                <span style={{ color: '#888', marginLeft: 8 }}>
                  {group.image_count} 张图片
                </span>
                <span style={{ color: '#666', marginLeft: 8, fontSize: 10 }}>
                  {t('duplicate.hitEvidence', '命中依据：{algorithms}')
                    .replace('{algorithms}', group.hit_evidence.map((a) => ALGO_LABELS[a] || a).join(', '))}
                </span>
              </div>
            </div>
            <div style={styles.groupActions}>
              {/* Review buttons */}
              {(['keep', 'mark', 'move'] as const).map((action) => (
                <button
                  key={action}
                  style={{
                    ...styles.reviewBtn,
                    ...(group.review?.action === action ? styles.reviewBtnActive : {}),
                    opacity: reviewingId === group.group_id ? 0.5 : 1,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReview(group.group_id, action);
                  }}
                  disabled={reviewingId === group.group_id}
                  title={t(`duplicate.action.${action}.hint`, '')}
                >
                  {t(`duplicate.action.${action}`, action)}
                </button>
              ))}
              <span style={styles.expandIcon}>
                {expandedGroup === group.group_id ? '▲' : '▼'}
              </span>
            </div>
          </div>

          {/* Expanded members */}
          {expandedGroup === group.group_id && (
            <div style={styles.membersList}>
              {group.members.map((member, idx) => (
                <div key={member.path} style={styles.memberRow}>
                  <span style={styles.memberIndex}>{idx + 1}.</span>
                  <span style={styles.memberPath} title={member.path}>
                    {member.path.split(/[\\/]/).pop() || member.path}
                  </span>
                  {idx === 0 && (
                    <span style={styles.repBadge}>
                      {t('duplicate.representative', '代表图')}
                    </span>
                  )}
                  <span style={styles.memberHash}>
                    {group.group_type === 'exact'
                      ? `SHA256: ${(member.sha256 || '').slice(0, 12)}...`
                      : `phash: ${(member.phash || '').slice(0, 8)}...`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {buildInfo?.duration_sec && (
        <div style={styles.footer}>
          构建耗时 {buildInfo.duration_sec} 秒
          {buildInfo.blake3_note && ` · ${buildInfo.blake3_note}`}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1a1a28',
    border: '1px solid #2a2a3e',
    borderRadius: 8,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: '#16161f',
    borderBottom: '1px solid #2a2a3e',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#ccc',
  },
  headerMeta: {
    fontSize: 11,
    color: '#888',
  },
  blake3Note: {
    fontSize: 10,
    color: '#7c9bff',
    padding: '2px 6px',
    background: 'rgba(124,155,255,0.1)',
    borderRadius: 3,
  },
  closeBtn: {
    padding: '4px 10px',
    background: '#2a2a3e',
    color: '#aaa',
    border: '1px solid #3a3a5e',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
  },
  filterBar: {
    display: 'flex',
    gap: 6,
    padding: '8px 14px',
    borderBottom: '1px solid #2a2a3e',
    flexWrap: 'wrap',
  },
  filterBtn: {
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    background: '#1e1e2e',
    color: '#aaa',
    border: '1px solid #2a2a3e',
  },
  filterBtnActive: {
    background: '#3a3a5e',
    color: '#7c9bff',
    border: '1px solid #7c9bff',
  },
  statusText: {
    padding: 24,
    textAlign: 'center',
    color: '#888',
    fontSize: 13,
  },
  errorText: {
    padding: 12,
    textAlign: 'center',
    color: '#e74c3c',
    fontSize: 12,
  },
  emptyState: {
    textAlign: 'center',
    padding: '30px 20px',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#aaa',
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 12,
    color: '#777',
    marginBottom: 16,
    lineHeight: 1.5,
    maxWidth: 400,
    margin: '0 auto 16px',
  },
  buildBtn: {
    padding: '8px 16px',
    background: '#2a3a2e',
    color: '#2ecc71',
    border: '1px solid rgba(46,204,113,0.3)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  groupCard: {
    borderBottom: '1px solid #222',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  groupBadge: {
    fontSize: 18,
    flexShrink: 0,
  },
  groupInfo: {
    flex: 1,
    minWidth: 0,
  },
  groupId: {
    fontSize: 12,
    fontWeight: 600,
    color: '#bbb',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  groupMeta: {
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  exactTag: {
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 10,
    background: 'rgba(46,204,113,0.15)',
    color: '#2ecc71',
    border: '1px solid rgba(46,204,113,0.2)',
  },
  perceptualTag: {
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 10,
    background: 'rgba(124,155,255,0.15)',
    color: '#7c9bff',
    border: '1px solid rgba(124,155,255,0.2)',
  },
  groupActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  reviewBtn: {
    padding: '3px 7px',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'inherit',
    background: '#1e1e2e',
    color: '#888',
    border: '1px solid #2a2a3e',
    transition: 'all 0.1s',
  },
  reviewBtnActive: {
    background: '#2a3a2e',
    color: '#2ecc71',
    border: '1px solid rgba(46,204,113,0.3)',
  },
  expandIcon: {
    fontSize: 10,
    color: '#555',
    marginLeft: 4,
  },
  membersList: {
    padding: '0 14px 10px',
  },
  memberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 8px',
    fontSize: 11,
    color: '#aaa',
    background: '#16161f',
    borderRadius: 4,
    marginTop: 4,
  },
  memberIndex: {
    color: '#555',
    minWidth: 20,
  },
  memberPath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#bbb',
  },
  repBadge: {
    padding: '1px 5px',
    borderRadius: 3,
    fontSize: 9,
    background: 'rgba(255,217,61,0.15)',
    color: '#ffd93d',
    border: '1px solid rgba(255,217,61,0.2)',
  },
  memberHash: {
    fontSize: 9,
    color: '#666',
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  footer: {
    padding: '8px 14px',
    fontSize: 10,
    color: '#666',
    textAlign: 'center',
    borderTop: '1px solid #2a2a3e',
  },
};
