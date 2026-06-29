export type ExportCartSource =
  | 'selected_images'
  | 'current_slice'
  | 'slice_top_n'
  | 'multi_slice_separate'
  | 'combined_and';

export type ExportFolderMode = 'single' | 'separate';
export type ExportCopyMode = 'copy_originals' | 'manifest_only';
export type ExportMergeMode = 'separate_folders' | 'single_folder';
export type ExportRenameMode = 'keep_original' | 'template' | 'sequence_original';

export type MixedSortMode =
  | 'primary_slice_order'
  | 'intersection_then_primary_rank'
  | 'average_rank';

export interface AnalysisImageIdentity {
  image_id: string;
  filename: string;
  original_rel_path?: string;
  original_path?: string;
  source_rel_path?: string;
  source_path?: string;
  image_path?: string;
  thumb_url?: string;
  original_available: boolean;
  original_width?: number;
  original_height?: number;
  original_file_size_bytes?: number;
  original_format?: string;
}

export interface ExportCartItem {
  id: string;
  name: string;
  source: ExportCartSource;
  image_ids: string[];
  slice_ids?: string[];
  matched_slices?: string[];
  top_n?: number;
  folder_name: string;
  folder_mode: ExportFolderMode;
  copy_mode: ExportCopyMode;
  rename_mode?: ExportRenameMode;   // per-item override
  rename_template?: string;         // per-item override
  skip_duplicates?: boolean;        // per-item
  dedupe_key?: string;
  created_at: string;
}

export interface ExportCartState {
  items: ExportCartItem[];
  output_dir: string;
  merge_mode: ExportMergeMode;
  dedupe_across_items: boolean;
  skip_duplicates: boolean;
  rename_mode: ExportRenameMode;
  rename_template: string;
}

export const DEFAULT_EXPORT_CART_STATE: ExportCartState = {
  items: [],
  output_dir: '',
  merge_mode: 'separate_folders',
  dedupe_across_items: true,
  skip_duplicates: false,
  rename_mode: 'template',
  rename_template: '{folder}_{index:04d}',
};

export function getExportCartStorageKey(jobId: string): string {
  return `analysis.exportCart:${jobId}`;
}

export function loadExportCart(jobId: string): ExportCartState {
  if (!jobId || typeof window === 'undefined') return DEFAULT_EXPORT_CART_STATE;
  try {
    const raw = window.localStorage.getItem(getExportCartStorageKey(jobId));
    if (!raw) return DEFAULT_EXPORT_CART_STATE;
    const parsed = JSON.parse(raw) as Partial<ExportCartState>;
    return {
      ...DEFAULT_EXPORT_CART_STATE,
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return DEFAULT_EXPORT_CART_STATE;
  }
}

export function saveExportCart(jobId: string, state: ExportCartState): void {
  if (!jobId || typeof window === 'undefined') return;
  window.localStorage.setItem(getExportCartStorageKey(jobId), JSON.stringify(state));
}

export function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

function encodeImageIdFallback(value: string): string {
  const bytes = new TextEncoder().encode(value.replace(/\\/g, '/'));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function getStableImageId(record: any): string {
  const imagePath = String(record.image_path || record.filename || record.path || '');
  const filename = imagePath.replace(/\\/g, '/').split('/').pop() || imagePath;
  return String(record.image_id || encodeImageIdFallback(imagePath || filename));
}

export function makeExportCartItem(params: {
  name: string;
  source: ExportCartSource;
  image_ids: string[];
  slice_ids?: string[];
  matched_slices?: string[];
  top_n?: number;
  folder_name?: string;
  folder_mode?: ExportFolderMode;
  copy_mode?: ExportCopyMode;
  rename_mode?: ExportRenameMode;
  rename_template?: string;
  skip_duplicates?: boolean;
}): ExportCartItem {
  const imageIds = uniqueIds(params.image_ids);
  const createdAt = new Date().toISOString();
  const folderName = sanitizeFolderName(params.folder_name || params.name);
  return {
    id: `${params.source}:${folderName}:${createdAt}`,
    name: params.name,
    source: params.source,
    image_ids: imageIds,
    slice_ids: params.slice_ids,
    matched_slices: params.matched_slices,
    top_n: params.top_n,
    folder_name: folderName,
    folder_mode: params.folder_mode || 'single',
    copy_mode: params.copy_mode || 'copy_originals',
    rename_mode: params.rename_mode,
    rename_template: params.rename_template,
    skip_duplicates: params.skip_duplicates,
    dedupe_key: uniqueIds([...imageIds].sort()).join('|'),
    created_at: createdAt,
  };
}

export function sanitizeFolderName(value: string): string {
  const trimmed = (value || 'analysis_export').trim();
  const cleaned = Array.from(trimmed, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || '<>:"/\\|?*'.includes(ch) ? '_' : ch;
  }).join('');
  return cleaned.slice(0, 80) || 'analysis_export';
}

export function intersectImageLists(lists: string[][], sortMode: MixedSortMode): string[] {
  if (lists.length === 0) return [];
  if (lists.length === 1) return uniqueIds(lists[0]);

  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const id of uniqueIds(list)) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const intersection = uniqueIds(lists[0]).filter((id) => counts.get(id) === lists.length);

  if (sortMode !== 'average_rank') return intersection;

  const rankMaps = lists.map((list) => {
    const map = new Map<string, number>();
    uniqueIds(list).forEach((id, index) => map.set(id, index));
    return map;
  });
  return intersection.sort((a, b) => {
    const scoreA = rankMaps.reduce((sum, map) => sum + (map.get(a) ?? Number.MAX_SAFE_INTEGER), 0) / rankMaps.length;
    const scoreB = rankMaps.reduce((sum, map) => sum + (map.get(b) ?? Number.MAX_SAFE_INTEGER), 0) / rankMaps.length;
    return scoreA - scoreB;
  });
}

export function resolveCombinedFilter(params: {
  primarySliceId: string;
  filterSliceIds: string[];
  topN?: number;
  resolveSliceImageIds: (sliceId: string) => string[];
}): string[] {
  const primaryList = uniqueIds(params.resolveSliceImageIds(params.primarySliceId));
  const filterSets = params.filterSliceIds
    .filter(Boolean)
    .map((sliceId) => new Set(uniqueIds(params.resolveSliceImageIds(sliceId))));
  const filtered = primaryList.filter((imageId) => filterSets.every((set) => set.has(imageId)));
  return params.topN && params.topN > 0 ? filtered.slice(0, params.topN) : filtered;
}

export function formatCartSource(source: ExportCartSource): string {
  switch (source) {
    case 'selected_images':
      return '手动选择';
    case 'current_slice':
      return '当前切片';
    case 'slice_top_n':
      return '切片前 N';
    case 'multi_slice_separate':
      return '多切片';
    case 'combined_and':
      return '组合筛选';
    default:
      return source;
  }
}

export function formatMixedSortMode(mode: MixedSortMode): string {
  switch (mode) {
    case 'primary_slice_order':
      return '按主条件排序';
    case 'intersection_then_primary_rank':
      return '只保留同时命中的图片，再按主条件排序';
    case 'average_rank':
      return '综合多个条件的排名';
    default:
      return mode;
  }
}
