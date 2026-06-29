/**
 * JobPicker — 任务选择器组件
 *
 * 展示已有 job 列表供用户选择，同时保留手动输入 job_id 降级。
 * 使用 P07-003 的 UI 组件（Card / Badge / Input / Button / EmptyState / LoadingState）。
 */
import { useState } from 'react';
import type { JobInfo } from '../../api/client';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import LoadingState from '../ui/LoadingState';
import ErrorState from '../ui/ErrorState';

interface JobPickerProps {
  jobs: JobInfo[];
  loading: boolean;
  error: string | null;
  onSelect: (jobId: string) => void;
  onReload: () => void;
}

export default function JobPicker({ jobs, loading, error, onSelect, onReload }: JobPickerProps) {
  const [manualId, setManualId] = useState('');

  const handleManualSubmit = () => {
    const trimmed = manualId.trim();
    if (trimmed) {
      onSelect(trimmed);
    }
  };

  return (
    <div>
      {/* ── Job list ── */}
      {loading && <LoadingState text="加载任务列表…" />}

      {error && (
        <ErrorState
          title="加载失败"
          message={error}
          onRetry={onReload}
        />
      )}

      {!loading && !error && jobs.length === 0 && (
        <EmptyState
          icon="📭"
          title="暂无分析任务"
          description="前往「新建分析」创建第一个整理任务"
          action={
            <a href="/react/new-analysis/" style={{ textDecoration: 'none' }}>
              <Button variant="primary">＋ 新建分析</Button>
            </a>
          }
        />
      )}

      {!loading && !error && jobs.length > 0 && (
        <div style={styles.list}>
          {jobs.map((job) => {
            const projectName = job.output_folder
              ? job.output_folder.split(/[\\/]/).filter(Boolean).pop() || job.id
              : job.id;
            const statusBadgeVariant = job.status === 'completed' ? 'success'
              : job.status === 'failed' ? 'danger'
              : job.status === 'running' ? 'info' : 'default';

            return (
              <Card
                key={job.id}
                variant="default"
                style={{ cursor: 'pointer', marginBottom: 6 }}
                onClick={() => onSelect(job.id)}
              >
                <div style={styles.row}>
                  <div style={styles.info}>
                    <div style={styles.name}>{projectName}</div>
                    <div style={styles.meta}>{job.id}</div>
                  </div>
                  <Badge variant={statusBadgeVariant}>
                    {job.status === 'completed' ? '已完成'
                      : job.status === 'failed' ? '失败'
                      : job.status === 'running' ? '运行中'
                      : job.status === 'pending' ? '排队中'
                      : job.status}
                  </Badge>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Manual input divider ── */}
      <div style={styles.divider}>
        <span style={styles.dividerLine} />
        <span style={styles.dividerText}>或手动输入任务 ID</span>
        <span style={styles.dividerLine} />
      </div>

      <div style={styles.manualRow}>
        <Input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
          placeholder="job_id"
          style={{ flex: 1, maxWidth: 400 }}
        />
        <Button onClick={handleManualSubmit} disabled={!manualId.trim()}>
          加载
        </Button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  list: {
    marginBottom: 16,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: 11,
    color: 'var(--text-faint, #555)',
    marginTop: 1,
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '16px 0',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--border, #2a2a3e)',
  },
  dividerText: {
    fontSize: 11,
    color: 'var(--text-faint, #555)',
    whiteSpace: 'nowrap',
  },
  manualRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
};
