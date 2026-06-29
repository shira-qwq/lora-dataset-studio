export interface WorkbenchPins {
  version: 1;
  jobId: string;
  clusterIds: string[];
  updatedAt: string;
}

function storageKey(jobId: string): string {
  return `organize.workbenchPins:${jobId}`;
}

export function loadWorkbenchPins(jobId: string): string[] {
  if (!jobId) return [];
  try {
    const raw = localStorage.getItem(storageKey(jobId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<WorkbenchPins>;
    if (parsed.version !== 1 || parsed.jobId !== jobId || !Array.isArray(parsed.clusterIds)) return [];
    return parsed.clusterIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

export function saveWorkbenchPins(jobId: string, clusterIds: string[]): void {
  if (!jobId) return;
  const unique = Array.from(new Set(clusterIds.filter(Boolean)));
  const payload: WorkbenchPins = {
    version: 1,
    jobId,
    clusterIds: unique,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(storageKey(jobId), JSON.stringify(payload));
  } catch {
    // localStorage can be unavailable in private contexts; pins are optional UI state.
  }
}
