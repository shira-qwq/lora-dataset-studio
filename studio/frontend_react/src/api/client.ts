export const SERVER_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SERVER_BASE) ||
  'http://127.0.0.1:8003';

export const API_BASE = `${SERVER_BASE}/api/v1`;

// ============================================================
// Analysis
// ============================================================

export interface AnalysisStatus {
  ok: boolean;
  histogram_ready: boolean;
  quality_edge_ready: boolean;
  basic_metadata_ready: boolean;
  basic_metadata_exists: boolean;
  available_sort_fields: string[];
  available_metadata_sort_fields: string[];
  /** @since v4.5-ui — capability manifest for each channel */
  capability: AnalysisCapability;
  /** @since P05-003 — optional plugin channel status */
  plugin_channels?: Record<string, PluginChannelInfo>;
}

/** Capability manifest: describes what each channel offers. */
export interface ChannelCapability {
  built: boolean;
  buildable: boolean;
  field_count: number;
  sort_fields: string[];
  filter_fields: string[];
  debug_only_fields: string[];
}

export interface AnalysisCapability {
  channels: Record<string, ChannelCapability>;
  total_built: number;
  total_buildable: number;
}

/** Optional plugin channel description (P05-003). */
export interface PluginChannelInfo {
  plugin_id: string;
  name_zh: string;
  description_zh: string;
  version: string;
  installed: boolean;
  available: boolean;
  buildable: boolean;
  buildable_note: string | null;
  requires_gpu: boolean;
  offline_supported: boolean;
  model_size_mb: number | null;
  failure_mode: string;
  cache_path: string | null;
}

export interface MetadataRecord {
  image_id?: string;
  image_path: string;
  width: number | null;
  height: number | null;
  megapixels: number | null;
  short_side: number | null;
  long_side: number | null;
  aspect_ratio: number | null;
  orientation: string | null;
  file_size_mb: number | null;
  has_alpha: boolean | null;
  transparent_ratio: number | null;
  overexposed_ratio: number | null;
  underexposed_ratio: number | null;
  clipping_ratio: number | null;
  /** Original image fields (may differ from thumbnail dimensions) */
  original_width?: number | null;
  original_height?: number | null;
  original_megapixels?: number | null;
  original_file_size_bytes?: number | null;
  original_format?: string | null;
}

export interface MetadataSummaryResponse {
  ok: boolean;
  total: number;
  offset: number;
  limit: number;
  records: MetadataRecord[];
}

export async function fetchAnalysisStatus(jobId: string): Promise<AnalysisStatus> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/analysis/status`);
  if (!resp.ok) throw new Error(`GET ${API_BASE}/jobs/${jobId}/analysis/status → HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchMetadataSummary(
  jobId: string, sortBy?: string, sortOrder?: string, limit?: number,
): Promise<MetadataSummaryResponse> {
  const params = new URLSearchParams();
  if (sortBy) params.set('sort_by', sortBy);
  if (sortOrder) params.set('sort_order', sortOrder);
  if (limit) params.set('limit', String(limit));
  const url = `${API_BASE}/jobs/${encodeURIComponent(jobId)}/analysis/metadata-summary?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`GET ${url} → ${resp.status}: ${body?.detail?.message || resp.statusText}`);
  }
  return resp.json();
}

// ============================================================
// Jobs
// ============================================================

export interface JobInfo {
  id: string;
  status: string;
  output_folder?: string;
  stage?: string;
  progress?: number;
  error?: string;
  /** @since P08-001 — ISO datetime string */
  created_at?: string;
  /** @since P08-001 — ISO datetime string, null until completed */
  completed_at?: string;
}

export interface JobsResponse {
  jobs: JobInfo[];
}

/**
 * Fetch job list from the primary job listing API.
 *
 * Preferred endpoint: `GET /api/v1/jobs` (from `studio/api/routers/jobs.py`).
 * Returns full job info (id, status, timestamps, output_folder, stage, progress, error).
 *
 * There is also `GET /api/v1/results/jobs` which returns less data
 * (no status/timestamps). Modern frontend pages (Home, Analysis JobPicker)
 * should use this endpoint. Organize's job picker also uses this endpoint.
 */
export async function fetchJobs(): Promise<JobsResponse> {
  const resp = await fetch(`${API_BASE}/jobs`);
  if (!resp.ok) throw new Error(`GET ${API_BASE}/jobs → HTTP ${resp.status}`);
  return resp.json();
}

// ============================================================
// Organize (v2)
// ============================================================

export interface ClusterInfo {
  id: string;
  name: string;
  count: number;
  color: string;
  confidence: number;
  suggested_name: string;
}

export interface ClustersResponse {
  clusters: ClusterInfo[];
}

/** Raw image item as returned by the backend. */
export interface ImageItem {
  filename: string;
  image_path: string;   // ← backend uses "image_path", NOT "path"
  cluster_id: number;
  cluster_name?: string;
  original_cluster_id?: number;
}

export interface ImagesResponse {
  images: ImageItem[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface SavePayload {
  moves: { filename: string; target_cluster_id: string }[];
  renames: { cluster_id: string; display_name: string }[];
  /** Optional: cluster layout positions */
  layout?: Record<string, { x: number; y: number }>;
  /** Optional: manual image order per cluster */
  manual_order?: Record<string, string[]>;
}

export interface SaveResponse {
  ok: boolean;
  moved: number;
  renamed: number;
  job_id: string;
}

/** Response from GET /{job_id}/organize/state */
export interface OrganizeStateResponse {
  ok: boolean;
  layout: Record<string, { x: number; y: number }>;
  manual_order: Record<string, string[]>;
}

export interface ExportResponse {
  ok: boolean;
  output_dir: string;
  exported_count: number;
  duration_sec: number;
  cluster_counts: Record<string, number>;
}

export async function fetchClusters(jobId: string): Promise<ClustersResponse> {
  const resp = await fetch(`${API_BASE}/results/${encodeURIComponent(jobId)}/clusters`);
  if (!resp.ok) throw new Error(`GET ${API_BASE}/results/${jobId}/clusters → HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchImages(jobId: string, clusterId: string, limit = 500): Promise<ImagesResponse> {
  const url = `${API_BASE}/results/${encodeURIComponent(jobId)}/images?cluster_id=${encodeURIComponent(clusterId)}&limit=${limit}&offset=0`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`GET ${url} → HTTP ${resp.status}`);
  return resp.json();
}

/** Build thumbnail URL from image_path. */
export function getThumbnailUrl(jobId: string, imagePath: string, size = 240, qualityKey?: string): string {
  // Ensure forward slashes for URLs, even on Windows
  let cleaned = (imagePath || '').replace(/\\/g, '/');
  // HACK: analysis channel sometimes stores thumbnails/xxx.jpg (pre-gen thumb path)
  // Strip the thumbnails/ prefix so the backend looks up by just filename.
  // The backend pregen fallback always checks d/thumbnails/{stem}.jpg anyway.
  cleaned = cleaned.replace(/^thumbnails\//i, '');
  const params = new URLSearchParams();
  params.set('path', cleaned);
  params.set('size', String(size));
  if (qualityKey) params.set('q', qualityKey);
  return `${SERVER_BASE}/api/v1/results/${encodeURIComponent(jobId)}/thumbnail?${params.toString()}`;
}

/**
 * Update an existing thumbnail URL to a different size.
 * Used when user changes thumbnail quality preference.
 */
export function updateThumbnailSize(thumbUrl: string, newSize: number, qualityKey?: string): string {
  try {
    const url = new URL(thumbUrl, window.location.origin);
    url.searchParams.set('size', String(newSize));
    if (qualityKey) url.searchParams.set('q', qualityKey);
    return url.toString();
  } catch {
    let next = thumbUrl.includes('size=')
      ? thumbUrl.replace(/size=\d+/, `size=${newSize}`)
      : `${thumbUrl}${thumbUrl.includes('?') ? '&' : '?'}size=${newSize}`;
    if (qualityKey) {
      next = next.includes('q=')
        ? next.replace(/q=[^&]*/, `q=${qualityKey}`)
        : `${next}&q=${qualityKey}`;
    }
    return next;
  }
}

/** Normalize a raw ImageItem from the API into a consistent shape. */
export function normalizeImage(raw: ImageItem, clusterId: string) {
  return {
    id: raw.filename,
    filename: raw.filename,
    image_path: raw.image_path || raw.filename,
    clusterId,
    thumbUrl: getThumbnailUrl('', raw.image_path || raw.filename).replace('/api/v1/results//thumbnail', ''),
    // thumbUrl set later with actual jobId
  };
}

export async function saveOrganizeState(jobId: string, payload: SavePayload): Promise<SaveResponse> {
  const resp = await fetch(`${API_BASE}/results/${encodeURIComponent(jobId)}/organize/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`POST ${API_BASE}/results/${jobId}/organize/save → ${resp.status}: ${body?.detail || resp.statusText}`);
  }
  return resp.json();
}

/** GET /{job_id}/organize/state — fetch layout + manual_order */
export async function fetchOrganizeState(jobId: string): Promise<OrganizeStateResponse> {
  const resp = await fetch(`${API_BASE}/results/${encodeURIComponent(jobId)}/organize/state`);
  if (!resp.ok) throw new Error(`GET /organize/state → HTTP ${resp.status}`);
  return resp.json();
}

/**
 * GET /api/v1/jobs/{job_id}/analysis/histogram-summary
 * 获取直方图通道摘要数据，支持排序和标签筛选。
 */
export interface HistogramRecord {
  image_path: string;
  brightness_dark_ratio: number | null;
  brightness_bright_ratio: number | null;
  brightness_entropy: number | null;
  saturation_low_ratio: number | null;
  saturation_high_ratio: number | null;
  hue_warm_ratio: number | null;
  hue_cool_ratio: number | null;
  histogram_outlier_score: number | null;
  labels: string | null;
  [key: string]: any;
}

export interface HistogramSummaryResponse {
  ok: boolean;
  total: number;
  offset: number;
  limit: number;
  records: HistogramRecord[];
}

export async function fetchHistogramSummary(
  jobId: string,
  sortBy?: string,
  sortOrder?: string,
  label?: string,
  limit = 100,
): Promise<HistogramSummaryResponse> {
  const params = new URLSearchParams();
  if (sortBy) params.set('sort_by', sortBy);
  if (sortOrder) params.set('sort_order', sortOrder);
  if (label) params.set('label', label);
  if (limit) params.set('limit', String(limit));
  const url = `${API_BASE}/jobs/${encodeURIComponent(jobId)}/analysis/histogram-summary?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`GET histogram-summary → ${resp.status}: ${body?.detail?.message || resp.statusText}`);
  }
  return resp.json();
}

/**
 * GET /api/v1/jobs/{job_id}/analysis/quality-edge-summary
 * 获取质量边缘通道摘要数据，支持排序和标签筛选。
 */
export interface QualityEdgeRecord {
  image_path: string;
  sharpness_score: number | null;
  blur_laplacian_var: number | null;
  edge_density: number | null;
  edge_strength_p95: number | null;
  local_contrast_p95: number | null;
  hue_coverage: number | null;
  lineart_score_v2: number | null;
  high_contrast_score_v2: number | null;
  flat_color_score: number | null;
  quality_edge_labels: string | null;
  [key: string]: any;
}

export interface QualityEdgeSummaryResponse {
  ok: boolean;
  total: number;
  offset: number;
  limit: number;
  records: QualityEdgeRecord[];
}

export async function fetchQualityEdgeSummary(
  jobId: string,
  sortBy?: string,
  sortOrder?: string,
  label?: string,
  limit = 100,
): Promise<QualityEdgeSummaryResponse> {
  const params = new URLSearchParams();
  if (sortBy) params.set('sort_by', sortBy);
  if (sortOrder) params.set('sort_order', sortOrder);
  if (label) params.set('label', label);
  if (limit) params.set('limit', String(limit));
  const url = `${API_BASE}/jobs/${encodeURIComponent(jobId)}/analysis/quality-edge-summary?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`GET quality-edge-summary → ${resp.status}: ${body?.detail?.message || resp.statusText}`);
  }
  return resp.json();
}

// ============================================================
// Duplicate Groups (P05-002)
// ============================================================

export interface DuplicateGroupMember {
  path: string;
  file_size?: number;
  sha256?: string;
  blake3?: string;
  phash?: string;
  dhash?: string;
  whash?: string;
  colorhash?: string;
}

export interface DuplicateGroup {
  group_id: string;
  group_type: 'exact' | 'perceptual';
  hit_evidence: string[];
  image_count: number;
  representative: string;
  members: DuplicateGroupMember[];
  review?: DuplicateReview;
}

export interface DuplicateReview {
  action?: 'keep' | 'mark' | 'move';
  note?: string;
  updated_at?: string;
}

export interface DuplicateGroupsResponse {
  ok: boolean;
  groups: DuplicateGroup[];
  stats: {
    total_exact_groups: number;
    total_perceptual_groups: number;
    total_duplicate_images: number;
    total_images_checked: number;
  };
  build_info?: {
    duration_sec?: number;
    blake3_available?: boolean;
    blake3_note?: string;
    [key: string]: any;
  };
}

export interface BuildDuplicateGroupsResponse {
  ok: boolean;
  channel: string;
  status: string;
  path: string;
  stats: DuplicateGroupsResponse['stats'];
  duration_sec: number;
  blake3_note: string;
}

/** POST /api/v1/jobs/{job_id}/analysis/duplicate-groups/build */
export async function buildDuplicateGroups(jobId: string): Promise<BuildDuplicateGroupsResponse> {
  const resp = await fetch(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/analysis/duplicate-groups/build`,
    { method: 'POST' },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`POST /duplicate-groups/build → ${resp.status}: ${body?.detail?.message || body?.detail || resp.statusText}`);
  }
  return resp.json();
}

/** GET /api/v1/jobs/{job_id}/analysis/duplicate-groups */
export async function fetchDuplicateGroups(
  jobId: string,
  groupType?: 'exact' | 'perceptual',
): Promise<DuplicateGroupsResponse> {
  const params = groupType ? `?group_type=${groupType}` : '';
  const resp = await fetch(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/analysis/duplicate-groups${params}`,
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`GET /duplicate-groups → ${resp.status}: ${body?.detail || resp.statusText}`);
  }
  return resp.json();
}

/** POST /api/v1/jobs/{job_id}/analysis/duplicate-groups/review */
export async function reviewDuplicateGroup(
  jobId: string,
  groupId: string,
  action: 'keep' | 'mark' | 'move',
  note?: string,
): Promise<{ ok: boolean; group_id: string; action: string }> {
  const resp = await fetch(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/analysis/duplicate-groups/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId, action, note }),
    },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`POST /duplicate-groups/review → ${resp.status}: ${body?.detail || resp.statusText}`);
  }
  return resp.json();
}

// ============================================================
// Jobs / Analysis creation
// ============================================================

export interface JobSchema {
  feature_groups: Record<string, { label: string; dims: number; enabled: boolean }>;
  params: Record<string, { label: string; type: string; default: number; min: number; max: number; step: number; description?: string }>;
  presets: string[];
}

export interface ScanFolderResponse {
  ok: boolean;
  image_count?: number;
  message?: string;
  path?: string;
  formats?: string[];
  sample_files?: string[];
}

export interface SubmitJobPayload {
  input_folders: string[];
  output_folder?: string;
  config?: Record<string, any>;
}

export interface SubmitJobResponse {
  job_id: string;
  status?: string;
}

export interface JobStatusResponse {
  id: string;
  status: string;
  stage?: string;
  progress?: number;
  error?: string;
  output_folder?: string;
}

export async function fetchJobSchema(): Promise<JobSchema> {
  const resp = await fetch(`${API_BASE}/jobs/schema`);
  if (!resp.ok) throw new Error(`GET ${API_BASE}/jobs/schema → HTTP ${resp.status}`);
  return resp.json();
}

export async function scanFolder(path: string): Promise<ScanFolderResponse> {
  const resp = await fetch(`${API_BASE}/jobs/scan-folder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error((body?.detail) || `POST scan-folder → HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function submitJob(payload: SubmitJobPayload): Promise<SubmitJobResponse> {
  const resp = await fetch(`${API_BASE}/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error((body?.detail) || `POST jobs → HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`);
  if (!resp.ok) throw new Error(`GET jobs/${jobId} → HTTP ${resp.status}`);
  return resp.json();
}

export interface JobLogResponse {
  lines: string[];
  offset: number;
  has_more: boolean;
  total: number;
}

export async function getJobLog(jobId: string, offset = 0): Promise<JobLogResponse> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/log?offset=${offset}`);
  if (!resp.ok) throw new Error(`GET jobs/${jobId}/log → HTTP ${resp.status}`);
  return resp.json();
}

/** Convenience: call getJobLog and return the concatenated lines as plain text. */
export async function getJobLogText(jobId: string, offset = 0): Promise<{ text: string; newOffset: number }> {
  const data = await getJobLog(jobId, offset);
  return {
    text: data.lines.join('\n'),
    newOffset: data.offset,
  };
}

/** Response from POST /jobs/{job_id}/analysis/build. */
export interface BuildChannelResponse {
  ok: boolean;
  channel: string;
  status: string;   // "built" | "already_ready"
  path: string;
  image_count: number;
  duration_sec: number;
}

/**
 * POST /api/v1/jobs/{job_id}/analysis/build?channel={channel}&force={force}
 * 构建 analysis channel (basic_metadata / histogram / quality_edge)。
 */
export async function buildAnalysisChannel(
  jobId: string, channel: string, force = false,
): Promise<BuildChannelResponse> {
  const resp = await fetch(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/analysis/build?channel=${encodeURIComponent(channel)}&force=${force}`,
    { method: 'POST' },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`POST /jobs/${jobId}/analysis/build?channel=${channel} → ${resp.status}: ${body?.detail?.message || body?.detail || resp.statusText}`);
  }
  return resp.json();
}

// ============================================================
// Recluster Preview (v4.5)
// ============================================================

/** Built-in recipe names matching the backend BUILTIN_RECIPES keys. */
export type RecipeName =
  | 'default_legacy16_raw_015'
  | 'preview_high_granularity'
  | 'preview_low_granularity';

/** Metrics for a single preview (subset of preview_metrics.json). */
export interface PreviewMetrics {
  silhouette: number | null;
  n_clusters: number | null;
  noise_rate: number | null;
  largest_cluster_ratio: number | null;
  live_features?: number | null;
  dead_features?: string[];
  alive_feature_names?: string[];
  created_at?: string;
}

/** Diff between current clustering and a preview. */
export interface DiffSummary {
  total_images: number | null;
  changed_cluster_count: number | null;
  changed_cluster_ratio: number | null;
  old_cluster_count: number | null;
  new_cluster_count: number | null;
  old_noise_rate: number | null;
  new_noise_rate: number | null;
  old_largest_cluster_ratio: number | null;
  new_largest_cluster_ratio: number | null;
}

/** Summary item returned by the list endpoint. */
export interface PreviewSummary {
  preview_id: string;
  recipe_name: string;
  metrics: PreviewMetrics;
  diff_summary: DiffSummary;
}

/** Full detail returned by the single-preview endpoint. */
export interface PreviewDetail {
  preview_id: string;
  recipe: { recipe_name: string; description?: string; is_default: boolean };
  preview_metrics: PreviewMetrics;
  diff_vs_current: DiffSummary;
  cluster_summary?: Record<string, { count: number; ratio: number }>;
  cluster_names?: Record<string, string>;
}

/** Response from the create-preview endpoint. */
export interface PreviewCreateResponse {
  ok: boolean;
  preview_id: string;
  output_path: string;
  metrics: PreviewMetrics;
  diff_summary: DiffSummary;
  alive_feature_names: string[];
  dead_features: string[];
}

/** Response from the apply-preview endpoint. */
export interface PreviewApplyResponse {
  ok: boolean;
  message: string;
  backup_path: string;
  note: string;
}

/** Error thrown when the backend returns HTTP 409 (manual edits detected). */
export class ManualEditsError extends Error {
  status: number;
  payload: any;
  constructor(message: string, payload?: any) {
    super(message);
    this.name = 'ManualEditsError';
    this.status = 409;
    this.payload = payload;
  }
}

/** Three built-in recipes, matching vanilla recluster-preview.js FALLBACK_RECIPES. */
export const FALLBACK_RECIPES: { name: RecipeName; label: string; description: string }[] = [
  { name: 'default_legacy16_raw_015', label: '默认稳定 16 维', description: '当前验证通过的稳定默认配置' },
  { name: 'preview_high_granularity', label: '更细分', description: '预览更多簇，可能更碎' },
  { name: 'preview_low_granularity', label: '更粗分', description: '预览更少簇，可能更合并' },
];

/**
 * POST /api/v1/jobs/{job_id}/recluster/preview
 * 创建重聚类预览。body: { recipe_name: "..." }
 */
export async function createPreview(jobId: string, recipeName: RecipeName): Promise<PreviewCreateResponse> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/recluster/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe_name: recipeName }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`POST /jobs/${jobId}/recluster/preview → ${resp.status}: ${body?.detail || resp.statusText}`);
  }
  return resp.json();
}

/**
 * GET /api/v1/jobs/{job_id}/recluster/previews
 * 列出所有已有 preview。返回 { ok, previews: PreviewSummary[] }。
 */
export async function listPreviews(jobId: string): Promise<PreviewSummary[]> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/recluster/previews`);
  if (!resp.ok) throw new Error(`GET /jobs/${jobId}/recluster/previews → HTTP ${resp.status}`);
  const data = await resp.json();
  return data.previews ?? [];
}

/**
 * GET /api/v1/jobs/{job_id}/recluster/previews/{preview_id}
 * 获取单个 preview 详情。从响应中提取 .preview 字段。
 */
export async function getPreviewDetail(jobId: string, previewId: string): Promise<PreviewDetail> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/recluster/previews/${encodeURIComponent(previewId)}`);
  if (!resp.ok) throw new Error(`GET /jobs/${jobId}/recluster/previews/${previewId} → HTTP ${resp.status}`);
  const data = await resp.json();
  return data.preview;
}

/**
 * POST /api/v1/jobs/{job_id}/recluster/previews/{preview_id}/apply
 * 应用 preview 作为当前 clustering。
 * body: { force: boolean }
 * 当 backend 返回 409 时抛出 ManualEditsError，其余非 2xx 抛普通 Error。
 */
export async function applyPreview(jobId: string, previewId: string, force = false): Promise<PreviewApplyResponse> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/recluster/previews/${encodeURIComponent(previewId)}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  if (resp.status === 409) {
    const body = await resp.json().catch(() => null);
    throw new ManualEditsError(
      body?.detail || `POST /jobs/${jobId}/recluster/previews/${previewId}/apply → 409: manual edits detected`,
      body,
    );
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`POST /jobs/${jobId}/recluster/previews/${previewId}/apply → ${resp.status}: ${body?.detail || resp.statusText}`);
  }
  return resp.json();
}

export async function exportByCluster(jobId: string): Promise<ExportResponse> {
  const resp = await fetch(`${API_BASE}/exports/copy-by-cluster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, include_user_moves: true }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`POST ${API_BASE}/exports/copy-by-cluster → ${resp.status}: ${body?.detail || resp.statusText}`);
  }
  return resp.json();
}

// ─── Image preview (original image, not thumbnail) ──────────────────────────

/**
 * Get original image URL by image_id.
 * Returns a URL that serves the original full-resolution image.
 */
export function getOriginalImageUrl(jobId: string, imageId: string): string {
  return `${API_BASE}/results/${encodeURIComponent(jobId)}/image?image_id=${encodeURIComponent(imageId)}`;
}

// ─── Analysis export API ────────────────────────────────────────────────────

export interface AnalysisExportPayload {
  mode: 'explicit_images' | 'selected_images' | 'current_slice' | 'multiple_slices';
  export_name?: string;
  output_dir?: string;
  base_output_dir?: string;
  image_ids?: string[];
  slice_ids?: string[];
  top_n?: number;
  folder_mode?: 'single' | 'separate';
  copy_mode?: 'copy_originals' | 'manifest_only';
  source_reason?: string;
  rename_mode?: 'keep_original' | 'template' | 'sequence_original';
  rename_template?: string;
  slice_name?: string;
  export_folder_name?: string;
}

export interface AnalysisExportResponse {
  ok: boolean;
  export_dir: string;
  copied_count: number;
  skipped_count: number;
  manifest_path: string;
  csv_path: string;
  warnings: string[];
}

export async function exportAnalysis(
  jobId: string,
  payload: AnalysisExportPayload,
): Promise<AnalysisExportResponse> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/analysis/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`POST analysis/export → ${resp.status}: ${body?.detail || resp.statusText}`);
  }
  return resp.json();
}
