/**
 * handoff.ts — Analysis → Organize 手递工具 (P10-004)
 *
 * 使用 sessionStorage 传递轻量巡检上下文。
 * 不涉及后端持久化。
 */

/** 单张图片的手递引用 */
export interface HandoffImageRef {
  filename: string;
  image_path?: string;
}

/** 手递数据结构 */
export interface AnalysisHandoffPayload {
  jobId: string;
  source: 'analysis_inspection';
  presetId: string;
  presetLabel: string;
  imageCount: number;
  imageRefs: HandoffImageRef[];
  createdAt: string;
}

/** sessionStorage key 格式 */
function storageKey(jobId: string, presetId: string): string {
  return `analysis_organize_handoff:${jobId}:${presetId}`;
}

/**
 * 写入手递数据到 sessionStorage
 */
export function writeHandoff(payload: AnalysisHandoffPayload): void {
  try {
    const key = storageKey(payload.jobId, payload.presetId);
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // sessionStorage full or unavailable — fail silently
  }
}

/**
 * 从 sessionStorage 读取手递数据
 */
export function readHandoff(jobId: string, presetId: string): AnalysisHandoffPayload | null {
  try {
    const key = storageKey(jobId, presetId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalysisHandoffPayload;
    // Validate
    if (parsed.jobId !== jobId || parsed.presetId !== presetId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 清除手递数据
 */
export function clearHandoff(jobId: string, presetId: string): void {
  try {
    const key = storageKey(jobId, presetId);
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * 从当前记录的 imageRefs 生成导航到 Organize 的 URL
 */
export function buildOrganizeUrl(jobId: string, presetId: string): string {
  return `${window.location.origin}/react/organize/?job_id=${encodeURIComponent(jobId)}&inspection=${encodeURIComponent(presetId)}`;
}
