/**
 * HomePage — 光影系统 Overview 控制台
 *
 * P09-006: 轻量抛光。更清晰的快捷入口、更实用的最近任务、更产品的空态。
 * 不出现 React V2 / legacy 等开发者词。
 */
import { useState, useEffect } from 'react';
import { fetchJobs } from '../api/client';
import type { JobInfo } from '../api/client';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import PageHeader from '../components/layout/PageHeader';
import Button from '../components/ui/Button';

/* ─── Quick action items ─── */
interface QuickAction {
  icon: string;
  title: string;
  desc: string;
  href: string;
  accent: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { icon: '＋', title: '新建光影分析', desc: '选择图片目录，自动聚类，进入整理画板', href: '/react/new-analysis/', accent: 'var(--accent, #7c9bff)' },
  { icon: '🗂️', title: '继续整理', desc: '拖拽整理图片到不同簇，保存导出重聚类', href: '/react/organize/', accent: 'var(--success, #46f1c5)' },
  { icon: '📊', title: '图片巡检', desc: '按亮度、色彩、质量快速浏览图片', href: '/react/analysis/', accent: 'var(--warning, #ffd93d)' },
];

export default function HomePage() {
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetchJobs();
        if (!cancelled) {
          setJobs(res.jobs || []);
          setBackendOk(true);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || '无法连接到后端服务');
          setBackendOk(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const completedJobs = jobs.filter((j) => j.status === 'completed');
  const recentJobs = jobs.slice(0, 10);

  return (
    <div style={styles.page}>
      {/* ── Welcome / Hero ── */}
      <PageHeader
        title="光影分类 Studio"
        subtitle="本地图片数据集整理工作台 — 输入目录，自动聚类，拖拽整理，导出结果"
      />

      {/* ── Quick Actions ── */}
      <div style={styles.sectionTitle}>快捷操作</div>
      <div style={styles.quickGrid}>
        {QUICK_ACTIONS.map((action) => (
          <a key={action.href} href={action.href} style={{ textDecoration: 'none' }}>
            <Card
              variant="default"
              style={{
                borderLeft: `3px solid ${action.accent}`,
                cursor: 'pointer',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                minHeight: 100,
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 4 }}>{action.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #e0e0e8)', marginBottom: 2 }}>
                {action.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', lineHeight: 1.4 }}>
                {action.desc}
              </div>
            </Card>
          </a>
        ))}
      </div>

      {/* ── Recent Jobs ── */}
      <div style={styles.sectionTitle}>最近任务</div>

      {loading && <LoadingState text="加载任务列表…" />}

      {error && !loading && (
        <ErrorState
          title="无法加载任务"
          message={error}
        />
      )}

      {!loading && !error && jobs.length === 0 && (
        <div style={styles.emptyWrap}>
          <EmptyState
            icon="📭"
            title="还没有分析任务"
            description="选择一个图片目录，开始第一次光影分析。"
            action={
              <a href="/react/new-analysis/" style={{ textDecoration: 'none' }}>
                <Button variant="primary" size="md">
                  ＋ 新建分析
                </Button>
              </a>
            }
          />
        </div>
      )}

      {!loading && !error && jobs.length > 0 && (
        <div style={styles.jobList}>
          {recentJobs.map((job) => {
            const projectName = job.output_folder
              ? job.output_folder.split(/[\\/]/).filter(Boolean).pop() || job.id
              : job.id;
            const statusColor = job.status === 'completed' ? 'var(--success, #46f1c5)'
              : job.status === 'failed' ? 'var(--danger, #ff5a6e)'
              : 'var(--warning, #ffd93d)';
            const statusText = job.status === 'completed' ? '已完成'
              : job.status === 'failed' ? '失败'
              : job.status === 'running' ? '运行中'
              : job.status === 'pending' ? '排队中'
              : job.status || '—';
            const statusBadgeVariant = job.status === 'completed' ? 'success' as const
              : job.status === 'failed' ? 'danger' as const
              : 'warning' as const;

            return (
              <div key={job.id} style={styles.jobCard}>
                <div style={styles.jobRow}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.jobName}>{projectName}</div>
                    <div style={styles.jobMeta}>{job.id.slice(0, 24)}…</div>
                  </div>
                  <Badge variant={statusBadgeVariant}>{statusText}</Badge>
                </div>
                <div style={styles.jobActions}>
                  <a href={`/react/organize/?job_id=${job.id}`} style={{ textDecoration: 'none' }}>
                    <Button variant="ghost" size="sm">🗂️ 整理</Button>
                  </a>
                  <a href={`/react/analysis/?job_id=${job.id}`} style={{ textDecoration: 'none' }}>
                    <Button variant="ghost" size="sm">📊 分析</Button>
                  </a>
                </div>
              </div>
            );
          })}

          {jobs.length > 10 && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <a href="/react/analysis/" style={{ color: 'var(--accent, #7c9bff)', fontSize: 12 }}>
                查看全部 {jobs.length} 个任务 →
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── System Status ── */}
      <div style={styles.sectionTitle}>服务状态</div>
      <div style={styles.statusRow}>
        <Card variant="default" style={{ flex: 1 }}>
          <div style={styles.statusInner}>
            <Badge variant={backendOk === true ? 'success' : backendOk === false ? 'danger' : 'default'}>
              {backendOk === null ? '检测中' : backendOk ? '在线' : '离线'}
            </Badge>
            <span style={styles.statusLabel}>后端分析服务</span>
          </div>
        </Card>
        <Card variant="default" style={{ flex: 1 }}>
          <div style={styles.statusInner}>
            <Badge variant="success">在线</Badge>
            <span style={styles.statusLabel}>前端界面</span>
          </div>
        </Card>
        <Card variant="default" style={{ flex: 1 }}>
          <div style={styles.statusInner}>
            <Badge variant={completedJobs.length > 0 ? 'success' : 'default'}>
              {completedJobs.length > 0 ? '就绪' : '无数据'}
            </Badge>
            <span style={styles.statusLabel}>分析通道</span>
          </div>
        </Card>
      </div>

      <div style={{ height: 32 }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '0 32px 32px',
    maxWidth: 900,
    margin: '0 auto',
    width: '100%',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-muted, #888)',
    marginBottom: 12,
    marginTop: 24,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quickGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  emptyWrap: {
    marginBottom: 24,
  },
  jobList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  jobCard: {
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 8,
    padding: '10px 14px',
    transition: 'border-color 0.12s',
  },
  jobRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 6,
  },
  jobName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  jobMeta: {
    fontSize: 11,
    color: 'var(--text-faint, #555)',
    marginTop: 1,
    fontFamily: 'monospace',
  },
  jobActions: {
    display: 'flex',
    gap: 6,
    paddingLeft: 18,
  },
  statusRow: {
    display: 'flex',
    gap: 10,
  },
  statusInner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  statusLabel: {
    fontSize: 12,
    color: 'var(--text-muted, #888)',
  },
};
