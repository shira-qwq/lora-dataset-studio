/**
 * useJobs — 任务列表 hook
 *
 * 轻量封装 fetchJobs()，管理加载/错误/数据状态。
 * 可复用：HomePage / JobPicker / Organize 等。
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchJobs } from '../api/client';
import type { JobInfo } from '../api/client';

interface UseJobsResult {
  jobs: JobInfo[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useJobs(): UseJobsResult {
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJobs();
      setJobs(res.jobs || []);
    } catch (e: any) {
      setError(e?.message || '无法加载任务列表');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { jobs, loading, error, reload: load };
}
