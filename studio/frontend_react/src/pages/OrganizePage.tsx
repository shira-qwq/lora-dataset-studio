import { useState, useEffect, useCallback, useRef } from 'react';
import type { ClusterInfo, ImageItem } from '../api/client';
import { fetchClusters, fetchImages, saveOrganizeState, exportByCluster, fetchJobs, getThumbnailUrl, fetchOrganizeState, updateThumbnailSize } from '../api/client';
import type { JobInfo } from '../api/client';
import type { ClusterData, FitMode, ImageData, ManualOrder, PendingMoves, PendingRenames, ClusterLayout, ViewMode } from '../components/organize/types';
import type { BoardRect } from '../components/organize/boardTypes';
import { buildClusterFrame } from '../components/organize/boardFrameBuilder';
import type { FrameBuildSettings } from '../components/organize/boardFrameBuilder';
import { solveOptimalColumns } from '../components/organize/boardColumnSolver';
import ClusterCard from '../components/organize/ClusterCard';
import ClusterSidebar from '../components/organize/ClusterSidebar';
import OrganizeToolbar from '../components/organize/OrganizeToolbar';
import DirtyStateBanner from '../components/organize/DirtyStateBanner';
import DebugPanel from '../components/organize/DebugPanel';
import OrganizeBoardLayout from '../components/organize/OrganizeBoardLayout';
import RglManualBoardLayout from '../components/organize/RglManualBoardLayout';
import type { RglManualBoardHandle } from '../components/organize/RglManualBoardLayout';
import ReclusterPreviewModal from '../components/organize/ReclusterPreviewModal';
import ViewStateSelector from '../components/organize/ViewStateSelector';
import InspectionQueuePanel from '../components/organize/InspectionQueuePanel';
import TargetClusterOverlay from '../components/organize/TargetClusterOverlay';
import { loadWorkbenchPins, saveWorkbenchPins } from '../components/organize/workbenchPins';
import type { ThumbnailQuality } from '../components/image-workspace/thumbnailQuality';
import {
  loadThumbnailQuality,
  saveThumbnailQuality,
  thumbnailQualityToSize,
} from '../components/image-workspace/thumbnailQuality';
import { t } from '../i18n/uiDictionary';

// ─── Tile size ─────────────────────────────────────────────────────────────

const MIN_TILE_PX = 72;
const MAX_TILE_PX = 192;
const DEFAULT_TILE_PX = 128;

/** Clamp and round to nearest 4px */
function clampTilePx(v: number): number {
  return Math.max(MIN_TILE_PX, Math.min(MAX_TILE_PX, Math.round(v / 4) * 4));
}

const VALID_FIT_MODES: readonly string[] = ['cover', 'contain'];

// Old localStorage keys to clean
const OLD_KEYS = [
  'org_layout', 'org_masonry_policy', 'org_density',
  'org_tile_size', 'org_fit_mode', 'org_thumb_quality',
  'organize.imageLayout', 'organize.masonryPolicy', 'organize.galleryDensity',
  'organize.boardMode',
  'organize.boardZoom', // camera zoom — no longer used
];

function loadOrganizeSetting<T>(key: string, def: T, valid: readonly string[]): T {
  try {
    const raw = localStorage.getItem('organize.' + key);
    if (raw && valid.includes(raw)) return raw as unknown as T;
  } catch { /* ignore */ }
  return def;
}

function saveOrganizeSetting(key: string, val: string) {
  try { localStorage.setItem('organize.' + key, val); } catch { /* ignore */ }
}

function resolveClusterColumnsForImageCount(
  imageCount: number,
  tileSizePx: number,
  tileGap: number,
): number {
  return solveOptimalColumns({
    imageCount,
    tileSizePx,
    tileGap,
    cardPaddingX: 8,
    cardPaddingY: 8,
    headerHeight: 44,
    borderWidth: 1,
    maxColumns: 6,
  });
}

/** Migrate old localStorage settings */
function migrateOldSettings(): { fitMode: FitMode } {
  let fitMode: FitMode = 'cover';
  const oldLayout = (() => { try { return localStorage.getItem('org_layout') || ''; } catch { return ''; } })();
  if (oldLayout) {
    if (oldLayout === 'contain-grid' || oldLayout === 'cover-grid') {
      fitMode = oldLayout === 'contain-grid' ? 'contain' : 'cover';
    }
    try { localStorage.removeItem('org_layout'); } catch { /* ignore */ }
  }
  const oldFitMode = (() => { try { return localStorage.getItem('org_fit_mode') || ''; } catch { return ''; } })();
  if (oldFitMode) {
    if (oldFitMode === 'contain-grid') fitMode = 'contain';
    else if (oldFitMode === 'cover-grid') fitMode = 'cover';
    try { localStorage.removeItem('org_fit_mode'); } catch { /* ignore */ }
  }
  for (const _k of OLD_KEYS) {
    try { localStorage.removeItem(_k); } catch { /* ignore */ }
  }
  return { fitMode };
}

const migrated = migrateOldSettings();

export default function OrganizePage() {
  const queryParams = new URLSearchParams(window.location.search);
  const jobId = queryParams.get('job_id') || '';
  const inspectionPresetId = queryParams.get('inspection') || undefined;

  // ── Core state ────────────────────────────────────────────────────────
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [pendingMoves, setPendingMoves] = useState<PendingMoves>({});
  const [pendingRenames, setPendingRenames] = useState<PendingRenames>({});
  const [selectedFilenames, setSelectedFilenames] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(new Set());
  const [pinnedClusterIds, setPinnedClusterIds] = useState<string[]>(() => loadWorkbenchPins(jobId));
  const [draggedFilename, setDraggedFilename] = useState<string | null>(null);

  // ── Tile size (continuous px, semantic zoom) ──────────────────────────
  const [tileSizePx, setTileSizePx] = useState<number>(() => {
    try {
      const v = localStorage.getItem('organize.tileSizePx');
      const n = parseInt(v || '', 10);
      if (!isNaN(n) && n >= MIN_TILE_PX && n <= MAX_TILE_PX) return clampTilePx(n);
    } catch { /* ignore */ }
    // Migrate from old 'tileSize' enum
    try {
      const old = localStorage.getItem('organize.tileSize');
      if (old === 'small') return 72;
      if (old === 'medium') return 96;
      if (old === 'large') return DEFAULT_TILE_PX;
      if (old === 'xlarge') return 160;
    } catch { /* ignore */ }
    return DEFAULT_TILE_PX;
  });

  const [fitMode, setFitMode] = useState<FitMode>(
    loadOrganizeSetting<FitMode>('fitMode', migrated.fitMode, VALID_FIT_MODES)
  );
  const [thumbnailQuality, setThumbnailQuality] = useState<ThumbnailQuality>(() => {
    try {
      const modern = localStorage.getItem('organize.thumbnailQuality');
      if (modern) return loadThumbnailQuality('organize.thumbnailQuality');
      const legacy = localStorage.getItem('organize.thumbQuality');
      if (legacy) {
        const migratedQuality = legacy === '256' ? 'small' : legacy === '768' ? 'large' : 'medium';
        localStorage.setItem('organize.thumbnailQuality', migratedQuality);
        localStorage.removeItem('organize.thumbQuality');
        return migratedQuality as ThumbnailQuality;
      }
    } catch { /* ignore */ }
    try {
      const v = localStorage.getItem('org_thumb_quality');
      const n = parseInt(v || '', 10);
      if (!isNaN(n) && [256, 384, 512, 768].includes(n)) {
        localStorage.removeItem('org_thumb_quality');
        return n === 256 ? 'small' : n === 768 ? 'large' : 'medium';
      }
    } catch { /* ignore */ }
    return 'medium';
  });
  const thumbnailQualityRef = useRef(thumbnailQuality);
  thumbnailQualityRef.current = thumbnailQuality;

  const getTileGap = (tilePx: number): number => {
    if (tilePx <= 72) return 4;
    if (tilePx <= 96) return 6;
    if (tilePx <= 128) return 8;
    return 10;
  };

  // RGL board ref
  const rglBoardRef = useRef<RglManualBoardHandle>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  // Layout & overlay state
  const [viewMode, setViewMode] = useState<ViewMode>('cluster');
  const [_clusterLayout, setClusterLayout] = useState<ClusterLayout>({});
  const [manualOrder, setManualOrder] = useState<ManualOrder>({});
  const [pendingLayout, setPendingLayout] = useState<ClusterLayout | null>(null);
  const viewModeRef = useRef(viewMode);

  // Fallback: if RGL board fails, use flex-wrap board
  const [rglFailed] = useState(false);

  // Job picker state
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [manualJobId, setManualJobId] = useState('');

  const isDirty =
    Object.keys(pendingMoves).length > 0 || Object.keys(pendingRenames).length > 0 || pendingLayout !== null;

  const totalImages = clusters.reduce((s, c) => s + c.images.length, 0);

  // Frame builder constants
  const CARD_PADDING_FRAME = 8;
  const HEADER_HEIGHT_FRAME = 44;
  const CARD_BORDER_FRAME = 1;

  // ── Compute board rects (per-cluster frames from tileSizePx) ──────────
  const boardRects: BoardRect[] = clusters.map((c, idx) => {
    const tileGap = getTileGap(tileSizePx);
    const cols = resolveClusterColumnsForImageCount(c.images.length, tileSizePx, tileGap);
    const settings: FrameBuildSettings = {
      tileSizePx,
      clusterColumns: cols,
      tileGap,
      cardPaddingX: CARD_PADDING_FRAME,
      cardPaddingY: CARD_PADDING_FRAME,
      headerHeight: HEADER_HEIGHT_FRAME,
      borderWidth: CARD_BORDER_FRAME,
    };
    const frame = buildClusterFrame(c.images.length, settings);
    return {
      clusterId: c.id,
      label: c.name,
      imageCount: c.images.length,
      order: idx,
      w: frame.w,
      h: frame.h,
    };
  });

  // ── Load jobs ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (jobId) return;
    let cancelled = false;
    setJobsLoading(true);
    fetchJobs()
      .then((data) => {
        if (cancelled) return;
        setJobs(data.jobs || []);
        // Auto-select most recent completed job
        const jobsList = data.jobs || [];
        if (jobsList.length > 0 && !queryParams.get('job_id')) {
          // Find most recent completed or last-accessed job
          const saved = localStorage.getItem('organize.lastJobId');
          const lastJob = saved ? jobsList.find(j => j.id === saved) : null;
          const best = lastJob || jobsList[0];
          if (best) {
            const url = new URL(window.location.href);
            url.searchParams.set('job_id', best.id);
            window.history.replaceState({}, '', url.toString());
            window.location.reload();
            return;
          }
        }
      })
      .catch((e) => { if (!cancelled) setJobsError(e.message); })
      .finally(() => { if (!cancelled) setJobsLoading(false); });
    return () => { cancelled = true; };
  }, [jobId]);

  // ── Load organize data ────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!jobId) return;
    // Save last accessed job
    try { localStorage.setItem('organize.lastJobId', jobId); } catch {}
    setIsLoading(true);
    setError(null);
    try {
      const clusterResp = await fetchClusters(jobId);
      let layout: ClusterLayout = {};
      let manualOrderData: ManualOrder = {};
      try {
        const stateResp = await fetchOrganizeState(jobId);
        if (stateResp.ok) {
          layout = stateResp.layout || {};
          manualOrderData = stateResp.manual_order || {};
        }
      } catch { /* optional */ }

      const clusterPromises = clusterResp.clusters
        .filter((c) => String(c.id) !== '-1')
        .map(async (c: ClusterInfo) => {
          const imgResp = await fetchImages(jobId, c.id, 500);
          let images: ImageData[] = (imgResp.images || []).map((img: ImageItem) => ({
            id: img.filename,
            image_id: (img as any).image_id,
            filename: img.filename,
            image_path: img.image_path || img.filename,
            clusterId: c.id,
            thumbUrl: getThumbnailUrl(
              jobId,
              img.image_path || img.filename,
              thumbnailQualityToSize(thumbnailQualityRef.current),
              thumbnailQualityRef.current,
            ),
          }));
          const clusterManualOrder = manualOrderData[c.id];
          if (clusterManualOrder && clusterManualOrder.length > 0) {
            const orderMap = new Map(clusterManualOrder.map((fn, i) => [fn, i]));
            images.sort((a, b) => {
              const ai = orderMap.get(a.filename) ?? 999;
              const bi = orderMap.get(b.filename) ?? 999;
              return ai - bi;
            });
          }
          return {
            id: c.id, name: c.name, count: c.count,
            color: c.color || '#46f1c5',
            suggestedName: c.suggested_name || c.name,
            images,
          } as ClusterData;
        });

      let loaded = await Promise.all(clusterPromises);
      if (Object.keys(layout).length > 0) {
        loaded.sort((a, b) => {
          const posA = layout[a.id]?.y ?? 999;
          const posB = layout[b.id]?.y ?? 999;
          return posA - posB;
        });
      } else {
        loaded.sort((a, b) => Number(a.id) - Number(b.id));
      }
      setClusters(loaded);
      setClusterLayout(layout);
      setManualOrder(manualOrderData);
      setPendingLayout(null);
      setPendingMoves({});
      setPendingRenames({});
    } catch (e: any) {
      setError(e.message || 'Failed to load organize data');
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    setPinnedClusterIds(loadWorkbenchPins(jobId));
    setDraggedFilename(null);
  }, [jobId]);

  // ── Image selection / drag ────────────────────────────────────────────
  const handleSelectImage = useCallback(
    (filename: string, _shiftKey: boolean, ctrlKey: boolean) => {
      setSelectedFilenames((prev) => {
        const next = new Set(prev);
        if (ctrlKey) { if (next.has(filename)) next.delete(filename); else next.add(filename); }
        else { next.clear(); next.add(filename); }
        return next;
      });
    }, [],
  );

  const handleClearSelection = useCallback(() => setSelectedFilenames(new Set()), []);
  const handleDragStart = useCallback((filename: string) => setDraggedFilename(filename), []);
  const handleDragEnd = useCallback(() => setDraggedFilename(null), []);

  const moveImageToCluster = useCallback(
    (filename: string, targetClusterId: string) => {
      const filesToMove = selectedFilenames.has(filename)
        ? Array.from(selectedFilenames) : [filename];
      const moveMap: PendingMoves = { ...pendingMoves };
      filesToMove.forEach((fn) => { moveMap[fn] = targetClusterId; });
      setPendingMoves(moveMap);
      setSelectedFilenames(new Set());
      setDraggedFilename(null);
      setClusters((prev) => {
        const updated = prev.map((c) => ({ ...c, images: [...c.images] }));
        const movedImages: Record<string, { filename: string; image_path: string }> = {};
        updated.forEach((c) => {
          c.images = c.images.filter((img) => {
            if (filesToMove.includes(img.filename)) {
              movedImages[img.filename] = { filename: img.filename, image_path: (img as any).image_path || img.filename };
              return false;
            }
            return true;
          });
        });
        const target = updated.find((c) => c.id === targetClusterId);
        if (target) {
          Object.values(movedImages).forEach((info) => {
            target.images.push({
              id: info.filename, filename: info.filename, image_path: info.image_path,
              clusterId: targetClusterId,
              thumbUrl: getThumbnailUrl(
                jobId,
                info.image_path,
                thumbnailQualityToSize(thumbnailQualityRef.current),
                thumbnailQualityRef.current,
              ),
            });
          });
        }
        return updated;
      });
    }, [jobId, selectedFilenames, pendingMoves],
  );
  const handleDrop = moveImageToCluster;

  const handleRename = useCallback(
    (clusterId: string, newName: string) => {
      setPendingRenames((prev) => ({ ...prev, [clusterId]: newName }));
      setClusters((prev) => prev.map((c) => (c.id === clusterId ? { ...c, name: newName } : c)));
    }, [],
  );

  // ── Save / Export / Refresh ────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    setSaving(true);
    try {
      const moves = Object.entries(pendingMoves).map(([fn, cid]) => ({ filename: fn, target_cluster_id: cid }));
      const renames = Object.entries(pendingRenames).map(([cid, name]) => ({ cluster_id: cid, display_name: name }));
      const layout: ClusterLayout = {};
      if (pendingLayout) Object.assign(layout, pendingLayout);
      clusters.forEach((c, i) => { layout[c.id] = layout[c.id] || { x: 0, y: i * 100 }; });
      const result = await saveOrganizeState(jobId, {
        moves, renames,
        layout: Object.keys(layout).length > 0 ? layout : undefined,
        manual_order: Object.keys(manualOrder).length > 0 ? manualOrder : undefined,
      });
      if (result.ok) { setPendingLayout(null); await loadData(); }
    } catch (e: any) { alert('保存失败: ' + e.message); }
    finally { setSaving(false); }
  }, [jobId, isDirty, pendingMoves, pendingRenames, pendingLayout, clusters, manualOrder, loadData]);

  const handleExport = useCallback(async () => {
    if (isDirty) {
      const shouldSave = window.confirm('当前有未保存的整理结果。\n请先保存再导出。\n\n点击"确定"先保存再导出，点击"取消"仅导出已保存状态。');
      if (shouldSave) { await handleSave(); if (isDirty) { alert('保存失败，请重试。'); return; } }
    }
    try {
      const result = await exportByCluster(jobId);
      if (result.ok) {
        alert([
          `✓ 导出完成`, `总目录: ${result.output_dir}`,
          ...Object.entries(result.cluster_counts).map(([k, v]) => `  ├─ ${k}/ (${v} 张)`),
          `共 ${result.exported_count} 张, 用时 ${result.duration_sec}s`,
        ].join('\n'));
      }
    } catch (e: any) { alert('导出失败: ' + e.message); }
  }, [jobId, isDirty, handleSave]);

  const handleRefresh = useCallback(async () => {
    if (isDirty) { const ok = window.confirm('当前有未保存修改，刷新会丢弃。是否继续？'); if (!ok) return; }
    setPendingMoves({}); setPendingRenames({}); setPendingLayout(null);
    await loadData();
  }, [isDirty, loadData]);

  // ── Navigation / collapse ──────────────────────────────────────────────
  const handleScrollTo = useCallback((clusterId: string) => {
    const el = document.getElementById(`cluster-${clusterId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const handleBack = useCallback(() => { window.location.href = '/react/'; }, []);
  const handleToggleCollapse = useCallback((clusterId: string) => {
    setCollapsedClusters((prev) => { const next = new Set(prev); if (next.has(clusterId)) next.delete(clusterId); else next.add(clusterId); return next; });
  }, []);
  const handleExpandAll = useCallback(() => {
    if (collapsedClusters.size === 0) setCollapsedClusters(new Set(clusters.map((c) => c.id)));
    else setCollapsedClusters(new Set());
  }, [collapsedClusters, clusters]);

  // ── Thumbnail quality ─────────────────────────────────────────────────
  useEffect(() => {
    if (clusters.length === 0) return;
    const size = thumbnailQualityToSize(thumbnailQuality);
    setClusters((prev) => prev.map((c) => ({
      ...c,
      images: c.images.map((img) => ({
        ...img,
        thumbUrl: updateThumbnailSize(img.thumbUrl, size, thumbnailQuality),
      })),
    })));
  }, [clusters.length, thumbnailQuality]);

  // ── Camera zoom state ──────────────────────────────────────────────────
  const [cameraZoom, setCameraZoom] = useState<number>(() => {
    // Try new key first, then migrate from old boardZoom
    try {
      const v = localStorage.getItem('organize.cameraZoom');
      const n = parseFloat(v || '');
      if (!isNaN(n) && n >= 0.4 && n <= 2.0) return Math.round(n * 100) / 100;
    } catch { /* ignore */ }
    try {
      const v = localStorage.getItem('organize.boardZoom');
      const n = parseFloat(v || '');
      if (!isNaN(n) && n >= 0.4 && n <= 2.0) {
        localStorage.setItem('organize.cameraZoom', String(n));
        localStorage.removeItem('organize.boardZoom');
        return Math.round(n * 100) / 100;
      }
    } catch { /* ignore */ }
    return 1.0;
  });

  const handleCameraZoomChange = useCallback((zoom: number) => {
    const z = Math.max(0.4, Math.min(2.0, Math.round(zoom * 100) / 100));
    setCameraZoom(z);
    try { localStorage.setItem('organize.cameraZoom', String(z)); } catch { /* ignore */ }
  }, []);

  // ── Semantic tile zoom ─────────────────────────────────────────────────
  const handleTileDelta = useCallback((delta: 1 | -1) => {
    setTileSizePx((prev) => {
      const factor = delta > 0 ? 1.08 : 0.92;
      const next = clampTilePx(Math.round(prev * factor));
      return next;
    });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      try { localStorage.setItem('organize.tileSizePx', String(tileSizePx)); } catch { /* ignore */ }
    }, 300);
    return () => window.clearTimeout(id);
  }, [tileSizePx]);

  // ── Settings handlers ─────────────────────────────────────────────────
  const handleFitModeChange = useCallback((mode: FitMode) => {
    setFitMode(mode);
    saveOrganizeSetting('fitMode', mode);
  }, []);
  const handleThumbnailQualityChange = useCallback((quality: ThumbnailQuality) => {
    setThumbnailQuality(quality);
    saveThumbnailQuality('organize.thumbnailQuality', quality);
  }, []);

  // ── RGL board actions ────────────────────────────────────────────────
  const handleAutoPack = useCallback(() => { rglBoardRef.current?.autoPack(); }, []);
  const handleFitToView = useCallback(() => {
    if (rglBoardRef.current) {
      rglBoardRef.current.fitToView();
      return;
    }
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }, []);
  const handleResetLayout = useCallback(() => {
    if (!jobId) return;
    const confirmed = window.confirm('重置画板位置？这不会影响图片分组和待保存修改。');
    if (!confirmed) return;
    rglBoardRef.current?.resetLayout();
  }, [jobId]);
  const handleTogglePin = useCallback((clusterId: string) => {
    setPinnedClusterIds((prev) => {
      const exists = prev.includes(clusterId);
      const next = exists ? prev.filter((id) => id !== clusterId) : [...prev, clusterId];
      saveWorkbenchPins(jobId, next);
      return next;
    });
  }, [jobId]);

  // ── Misc ─────────────────────────────────────────────────────────────
  const handleToggleDebug = useCallback(() => setShowDebug((p) => !p), []);
  const handleRepack = useCallback(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const handlePreviewApplied = useCallback(async () => {
    setShowPreview(false);
    setPendingMoves({}); setPendingRenames({}); setSelectedFilenames(new Set()); setPendingLayout(null);
    await loadData();
  }, [loadData]);
  const handleOpenPreview = useCallback(() => {
    if (isDirty) {
      const ok = window.confirm('当前有未保存的整理结果。\n建议先保存再预览重聚类。\n\n点击"确定"继续打开预览，\n点击"取消"先保存。');
      if (!ok) { handleSave().then(() => setShowPreview(true)); return; }
    }
    setShowPreview(true);
  }, [isDirty, handleSave]);
  const handleClusterDragStart = useCallback((_clusterId: string) => {}, []);
  const handleClusterDrop = useCallback((draggedId: string, targetId: string) => {
    setClusters((prev) => {
      const arr = [...prev];
      const fromIdx = arr.findIndex((c) => c.id === draggedId);
      const toIdx = arr.findIndex((c) => c.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      const newLayout: ClusterLayout = {};
      arr.forEach((c, i) => { newLayout[c.id] = { x: 0, y: i * 100 }; });
      setPendingLayout(newLayout);
      return arr;
    });
  }, []);
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    viewModeRef.current = mode;
    setViewMode(mode);
    if (mode === 'manual') loadData();
  }, [loadData]);

  // ESC to deselect
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedFilenames(new Set()); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Persist settings
  useEffect(() => { saveOrganizeSetting('fitMode', fitMode); }, [fitMode]);
  useEffect(() => { saveThumbnailQuality('organize.thumbnailQuality', thumbnailQuality); }, [thumbnailQuality]);

  const allExpanded = collapsedClusters.size === 0;
  const openJob = (jid: string) => { window.location.href = `/react/organize/?job_id=${encodeURIComponent(jid)}`; };

  // ================================================================
  // Render: Job picker
  // ================================================================
  if (!jobId) {
    return (
      <div style={styles.page}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 40 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: '#ddd', marginBottom: 20 }}>{t('organize.selectJob', '⚛️ Organize — Select Job')}</h1>
          {jobsLoading && <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>Loading jobs...</div>}
          {jobsError && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ color: '#e74c3c', fontSize: 13, marginBottom: 12 }}>Failed to load jobs: {jobsError}</div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Enter job ID manually:</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={manualJobId} onChange={(e) => setManualJobId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && manualJobId.trim()) openJob(manualJobId.trim()); }}
                  placeholder="job_id" style={inputStyle} />
                <button onClick={() => { if (manualJobId.trim()) openJob(manualJobId.trim()); }} style={btnStyle}>Open</button>
              </div>
            </div>
          )}
          {!jobsLoading && !jobsError && jobs.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>
              No jobs found. Create one in <a href="/react/new-analysis/" style={{ color: '#7c9bff' }}>New Analysis</a> first.
            </div>
          )}
          {!jobsLoading && jobs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {jobs.map((job) => {
                const project = job.output_folder ? job.output_folder.split(/[\\/]/).pop() || job.id : job.id;
                const statusColor = job.status === 'completed' ? '#2ecc71' : job.status === 'failed' ? '#e74c3c' : '#f0ad4e';
                return (
                  <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{job.id} · {job.status}</div>
                    </div>
                    <button onClick={() => openJob(job.id)} style={btnStyle}>⚛️ Organize</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ================================================================
  // Render: Loading / Error
  // ================================================================
  if (isLoading) {
    return <div style={styles.page}><div style={{ padding: 40, textAlign: 'center', color: '#666' }}>{t('organize.loading', 'Loading organize data...')}</div></div>;
  }
  if (error) {
    return <div style={styles.page}><div style={{ padding: 40, textAlign: 'center', color: '#e74c3c' }}>Error: {error}</div></div>;
  }

  // ================================================================
  // Render: Organize main view
  // ================================================================
  return (
    <div style={styles.page}>
      <OrganizeToolbar
        jobId={jobId}
        totalImages={totalImages}
        clusterCount={clusters.length}
        selectedCount={selectedFilenames.size}
        isDirty={isDirty}
        saving={saving}
        fitMode={fitMode}
        onFitModeChange={handleFitModeChange}
        thumbnailQuality={thumbnailQuality}
        onThumbnailQualityChange={handleThumbnailQualityChange}
        cameraZoom={cameraZoom}
        onAutoPack={handleAutoPack}
        onResetLayout={handleResetLayout}
        onFitToView={handleFitToView}
        allExpanded={allExpanded}
        onSave={handleSave}
        onExport={handleExport}
        onRefresh={handleRefresh}
        onBack={handleBack}
        onClearSelection={handleClearSelection}
        onToggleDebug={handleToggleDebug}
        onExpandAll={handleExpandAll}
        onRepack={handleRepack}
        onOpenPreview={handleOpenPreview}
        extraWidget={
          <ViewStateSelector mode={viewMode} onChange={handleViewModeChange} isDirty={isDirty} />
        }
      />
      <DirtyStateBanner
        pendingMoves={Object.keys(pendingMoves).length}
        pendingRenames={Object.keys(pendingRenames).length}
        onSave={handleSave}
        onRefresh={handleRefresh}
      />
      <InspectionQueuePanel jobId={jobId} inspectionPresetId={inspectionPresetId} />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ClusterSidebar
          clusters={clusters}
          pinnedClusterIds={pinnedClusterIds}
          onScrollTo={handleScrollTo}
          onTogglePin={handleTogglePin}
          onDropImage={handleDrop}
        />
        <div ref={mainRef} style={{ flex: 1, overflowY: 'auto', padding: 16, background: 'var(--bg, #12121a)' }}>
          {rglFailed ? (
            <>
              <div style={{ padding: '8px 12px', marginBottom: 12, background: 'var(--warning-bg, #332)', color: 'var(--warning, #f5a623)', borderRadius: 4, fontSize: 11 }}>
                画板布局暂时不可用，已切换到基础浏览模式。
              </div>
              <OrganizeBoardLayout clusters={clusters}
                renderClusterCard={(c) => (
                  <ClusterCard jobId={jobId} cluster={c} selectedFilenames={selectedFilenames}
                    collapsed={collapsedClusters.has(c.id)} tilePixelSize={tileSizePx}
                    clusterColumns={resolveClusterColumnsForImageCount(c.images.length, tileSizePx, getTileGap(tileSizePx))}
                    isPinned={pinnedClusterIds.includes(c.id)}
                    fitMode={fitMode} boardMode="flow"
                    onSelectImage={handleSelectImage} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDrop={handleDrop}
                    onRename={handleRename} onToggleCollapse={handleToggleCollapse} onTogglePin={handleTogglePin}
                    onClusterDragStart={handleClusterDragStart} onClusterDrop={handleClusterDrop} />
                )}
              />
            </>
          ) : (
            <RglManualBoardLayout
              ref={rglBoardRef}
              jobId={jobId}
              clusters={clusters}
              boardRects={boardRects}
              pinnedClusterIds={pinnedClusterIds}
              onTileDelta={handleTileDelta}
              cameraZoom={cameraZoom}
              onCameraZoomChange={handleCameraZoomChange}
              renderClusterCard={(c) => (
                <ClusterCard jobId={jobId} cluster={c} selectedFilenames={selectedFilenames}
                  collapsed={collapsedClusters.has(c.id)} tilePixelSize={tileSizePx}
                  clusterColumns={resolveClusterColumnsForImageCount(c.images.length, tileSizePx, getTileGap(tileSizePx))}
                  isPinned={pinnedClusterIds.includes(c.id)}
                  fitMode={fitMode} boardMode="manual"
                  onSelectImage={handleSelectImage} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDrop={handleDrop}
                  onRename={handleRename} onToggleCollapse={handleToggleCollapse} onTogglePin={handleTogglePin} />
              )}
            />
          )}
        </div>
      </div>
      {showDebug && <DebugPanel info={{
        jobId, clusterCount: clusters.length, imageCount: totalImages,
        firstImagePath: clusters[0]?.images[0]?.image_path || null,
        firstThumbUrl: clusters[0]?.images[0]?.thumbUrl || null,
        lastError: error, apiBase: 'http://127.0.0.1:8003/api/v1',
        serverBase: 'http://127.0.0.1:8003',
        missingThumbCount: clusters.reduce((s, c) => s + c.images.filter(i => !i.thumbUrl).length, 0),
        hasThumbCount: clusters.reduce((s, c) => s + c.images.filter(i => i.thumbUrl).length, 0),
        firstRawImage: JSON.stringify(clusters[0]?.images[0] || null),
        firstNormalizedImage: JSON.stringify({ id: clusters[0]?.images[0]?.id, filename: clusters[0]?.images[0]?.filename, image_path: (clusters[0]?.images[0] as any)?.image_path, thumbUrl: clusters[0]?.images[0]?.thumbUrl }),
      }} />}
      <TargetClusterOverlay
        clusters={clusters}
        pinnedClusterIds={pinnedClusterIds}
        draggedFilename={draggedFilename}
        onDropImage={handleDrop}
        onClose={() => setDraggedFilename(null)}
      />
      <ReclusterPreviewModal jobId={jobId} open={showPreview} onClose={() => setShowPreview(false)} onApplied={handlePreviewApplied} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    background: 'var(--bg, #12121a)', color: 'var(--text, #e0e0e8)',
    fontFamily: "'Inter', system-ui, sans-serif", overflow: 'hidden',
  },
};

const btnStyle: React.CSSProperties = {
  padding: '6px 14px', background: '#3a3a5e', color: '#ccc',
  border: '1px solid #4a4a6e', borderRadius: 4, cursor: 'pointer',
  fontSize: 12, fontFamily: 'inherit', fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  flex: 1, padding: '8px 12px', background: '#1e1e2e',
  border: '1px solid #3a3a4e', borderRadius: 4, color: '#ccc',
  fontSize: 13, outline: 'none', fontFamily: 'inherit', maxWidth: 300,
};
