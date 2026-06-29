import { API_BASE, SERVER_BASE } from './client';
import type { ClusterRef, ImageRef, JobManifest } from '../types/jobWorkspace';

function absolutize(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${SERVER_BASE}${url.startsWith('/') ? url : `/${url}`}`;
}

function mapImageRef(raw: any): ImageRef {
  return {
    imageId: raw.image_id ?? raw.imageId,
    filename: raw.filename ?? '',
    width: raw.width ?? null,
    height: raw.height ?? null,
    exists: Boolean(raw.exists),
    thumbnailUrl: absolutize(raw.thumbnail_url ?? raw.thumbnailUrl),
    originalUrl: absolutize(raw.original_url ?? raw.originalUrl),
    missingReason: raw.missing_reason ?? raw.missingReason ?? null,
  };
}

function mapClusterRef(raw: any): ClusterRef {
  return {
    clusterId: String(raw.cluster_id ?? raw.id),
    title: raw.title ?? raw.name ?? `Cluster ${raw.cluster_id ?? raw.id}`,
    imageIds: Array.isArray(raw.image_ids) ? raw.image_ids : [],
    images: Array.isArray(raw.images) ? raw.images.map(mapImageRef) : [],
    color: raw.color,
    count: raw.count,
    suggestedName: raw.suggested_name ?? raw.suggestedName,
  };
}

export async function getJobManifest(jobId: string): Promise<JobManifest> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/manifest`);
  if (!resp.ok) throw new Error(`GET job manifest -> HTTP ${resp.status}`);
  return resp.json();
}

export async function getJobImages(jobId: string, size = 384): Promise<ImageRef[]> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/images?size=${size}`);
  if (!resp.ok) throw new Error(`GET job images -> HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.images || []).map(mapImageRef);
}

export async function getJobClusters(jobId: string, size = 384): Promise<ClusterRef[]> {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/clusters?size=${size}`);
  if (!resp.ok) throw new Error(`GET job clusters -> HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.clusters || []).map(mapClusterRef);
}

export async function exportJobImages(
  jobId: string,
  payload: { imageIds: string[]; folderName?: string; renameMode?: string; skipDuplicates?: boolean },
) {
  const resp = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/exports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_ids: payload.imageIds,
      folder_name: payload.folderName,
      rename_mode: payload.renameMode,
      skip_duplicates: payload.skipDuplicates,
    }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(`POST job export -> ${resp.status}: ${body?.detail || resp.statusText}`);
  }
  return resp.json();
}
