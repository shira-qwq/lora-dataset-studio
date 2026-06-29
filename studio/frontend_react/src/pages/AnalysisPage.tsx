/**
 * AnalysisPage 鈥?鍥剧墖宸℃ / 鍒嗘瀽鏁版嵁鎺у埗鍙? *
 * P09-004: 榛樿瑙嗗浘涓哄浘鐗囧贰妫€锛坕mage inspection锛夛紝
 * 鍘熷鏁版嵁浣滀负楂樼骇瑙嗗浘淇濈暀銆? *
 * 宸℃瑙嗗浘浣跨敤 inspectionManifest 鍒囩墖棰勮锛? * 涓嶅湪椤甸潰涓‖缂栫爜鍒囩墖 if/else 鍒楄〃銆? *
 * P07-006: 鐜颁唬鍖栭噸鏋勩€侸obPicker 浼樺厛閫夋嫨 job锛屾墜鍔ㄨ緭鍏ラ檷绾т负楂樼骇鍏ュ彛銆? * 淇濈暀 ChannelPanel / DuplicateGroupsView / PluginPanel / ChannelDataViewer 鐨勬牳蹇冮€昏緫銆? */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { AnalysisStatus, ChannelCapability, AnalysisExportPayload } from '../api/client';
import {
  fetchAnalysisStatus,
  buildAnalysisChannel,
  exportAnalysis,
  fetchMetadataSummary,
  fetchHistogramSummary,
  fetchQualityEdgeSummary,
  fetchJobs as fetchAnalysisJobs,
} from '../api/client';
import { useJobs } from '../hooks/useJobs';
import ChannelPanel from '../components/ChannelPanel';
import type { PanelChannelEntry } from '../components/ChannelPanel';
import ChannelDataViewer from '../components/ChannelDataViewer';
import DuplicateGroupsView from '../components/DuplicateGroupsView';
import PluginPanel from '../components/PluginPanel';
import JobPicker from '../components/job/JobPicker';
import PageHeader from '../components/layout/PageHeader';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import InspectionSliceBar from '../components/analysis/InspectionSliceBar';
import ImageInspectionGrid from '../components/analysis/ImageInspectionGrid';
import type { ImageCardData } from '../components/analysis/ImageInspectionCard';
import DuplicateGroupGallery from '../components/analysis/DuplicateGroupGallery';
import ExportCartPanel from '../components/analysis/ExportCartPanel';
import ExportSettingsDialog from '../components/analysis/ExportSettingsDialog';
import type { ExportRenameMode } from '../analysis/exportCart';
import ExportRuleBuilder from '../components/analysis/ExportRuleBuilder';
import { resolvePreset, checkSliceAvailability, getSliceLabel } from '../analysis/inspectionManifest';
import { getAllPresets } from '../analysis/inspectionPresets';
import {
  DEFAULT_EXPORT_CART_STATE,
  loadExportCart,
  makeExportCartItem,
  saveExportCart,
  sanitizeFolderName,
  getStableImageId,
  uniqueIds,
} from '../analysis/exportCart';
import type { ExportCartState } from '../analysis/exportCart';
import type { ThumbnailQuality } from '../components/image-workspace/thumbnailQuality';
import {
  THUMBNAIL_QUALITY_OPTIONS,
  loadThumbnailQuality,
  saveThumbnailQuality,
} from '../components/image-workspace/thumbnailQuality';
import { t } from '../i18n/uiDictionary';

/* 鈹€鈹€鈹€ Panel group definitions 鈹€鈹€鈹€ */
interface PanelGroup {
  key: string;
  title: string;
  description: string;
  icon: string;
  channels: string[];
}

const PANEL_GROUPS: PanelGroup[] = [
  {
    key: 'basicInfo',
    title: t('analysis.panel.basicInfo', '基础信息'),
    description: t('analysis.panel.basicInfo.desc', '分辨率、尺寸、透明通道、过曝和死黑等基础图片信息'),
    icon: 'Info',
    channels: ['basic_metadata'],
  },
  {
    key: 'exposureColor',
    title: t('analysis.panel.exposureColor', '曝光 / 色彩'),
    description: t('analysis.panel.exposureColor.desc', '亮度分布、饱和度、冷暖和直方图异常检测'),
    icon: 'Color',
    channels: ['histogram'],
  },
  {
    key: 'qualityEdge',
    title: t('analysis.panel.qualityEdge', '质量 / 边缘'),
    description: t('analysis.panel.qualityEdge.desc', '模糊检测、锐度、边缘密度和局部对比度'),
    icon: 'Focus',
    channels: ['quality_edge'],
  },
  {
    key: 'duplicateGroups',
    title: t('analysis.panel.duplicateGroups', '重复图检测'),
    description: t('analysis.panel.duplicateGroups.desc', '查找完全一致和感知相似的重复图片'),
    icon: 'Copy',
    channels: ['duplicate_groups'],
  },
  {
    key: 'modelPlugins',
    title: t('analysis.panel.modelPlugins', '可选模型分析'),
    description: t('analysis.panel.modelPlugins.desc', '接入第三方离线模型进行风格、标签或检测分析'),
    icon: 'Model',
    channels: ['model_plugins'],
  },
];

type ViewMode = 'inspection' | 'raw-data';

async function fetchSliceRecordsForExport(
  jobId: string,
  sliceId: string,
  capability: AnalysisStatus['capability'] | null,
  limit = 500,
): Promise<any[]> {
  const preset = resolvePreset(sliceId);
  if (!preset) return [];
  const availability = checkSliceAvailability(preset, capability);
  if (!availability.available) return [];

  const sortField = preset.sortBy?.field || undefined;
  const sortOrder = preset.sortBy?.order || undefined;
  const channelKey = preset.requiredChannel || 'basic_metadata';

  try {
    if (channelKey === 'histogram') {
      return (await fetchHistogramSummary(jobId, sortField, sortOrder, undefined, limit)).records || [];
    }
    if (channelKey === 'quality_edge') {
      return (await fetchQualityEdgeSummary(jobId, sortField, sortOrder, undefined, limit)).records || [];
    }
    return (await fetchMetadataSummary(jobId, sortField, sortOrder, limit)).records || [];
  } catch {
    if (channelKey === 'histogram') {
      return (await fetchHistogramSummary(jobId, undefined, undefined, undefined, limit)).records || [];
    }
    if (channelKey === 'quality_edge') {
      return (await fetchQualityEdgeSummary(jobId, undefined, undefined, undefined, limit)).records || [];
    }
    return (await fetchMetadataSummary(jobId, undefined, undefined, limit)).records || [];
  }
}

export default function AnalysisPage() {
  // 鈹€鈹€ URL-based job_id 鈹€鈹€
  const queryParams = new URLSearchParams(window.location.search);
  const initialJobId = queryParams.get('job_id') || '';

  
  const [jobId, setJobId] = useState(initialJobId);
  
  if (!initialJobId) {
    // Will attempt auto-select below
  }
  
  // Auto-select most recent job if none specified
  const jobsFetcherRef = useRef(false);
  useEffect(() => {
    if (initialJobId) return;
    if (jobsFetcherRef.current) return;
    jobsFetcherRef.current = true;
    let cancelled = false;
    fetchAnalysisJobs().then((data) => {
      if (cancelled) return;
      const jobsList = data.jobs || [];
      if (jobsList.length === 0) return;
      const saved = localStorage.getItem('analysis.lastJobId');
      const lastJob = saved ? jobsList.find((j: any) => j.id === saved) : null;
      const best = lastJob || jobsList[0];
      if (best) {
        const url = new URL(window.location.href);
        url.searchParams.set('job_id', best.id);
        window.history.replaceState({}, '', url.toString());
        window.location.reload();
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [initialJobId]);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [building, setBuilding] = useState<Record<string, boolean>>({});
  const [buildError, setBuildError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [activeViewChannel, setActiveViewChannel] = useState<string | null>(null);

  // 鈹€鈹€ P09-004: view mode 鈹€鈹€
  const [viewMode, setViewMode] = useState<ViewMode>('inspection');
  const [activeSlice, setActiveSlice] = useState('all');

  // 鈹€鈹€ P11-001: Export 鈹€鈹€
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportCart, setExportCart] = useState<ExportCartState>(DEFAULT_EXPORT_CART_STATE);
  const [visibleImagesBySlice, setVisibleImagesBySlice] = useState<Record<string, ImageCardData[]>>({});
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set());
  const [exportBatchTopN, setExportBatchTopN] = useState(5);
  const [selectionTopN, setSelectionTopN] = useState(12);
  const [thumbnailQuality, setThumbnailQuality] = useState<ThumbnailQuality>(() => loadThumbnailQuality('analysis.thumbnailQuality'));

  // P10-003: resolve preset for viewType routing
  const activePreset = useMemo(() => resolvePreset(activeSlice), [activeSlice]);
  const isGroupedGallery = activePreset?.viewType === 'grouped_gallery';
  const currentVisibleImages = useMemo(
    () => visibleImagesBySlice[activeSlice] || [],
    [activeSlice, visibleImagesBySlice],
  );
  const selectedCount = selectedImageIds.size;
  const sliceOptions = useMemo(() => getAllPresets()
    .filter((preset) => preset.viewType !== 'grouped_gallery')
    .filter((preset) => !status?.capability || checkSliceAvailability(preset, status.capability).available)
    // Hide "all" if no channel data is available (avoids empty state)
    .filter((preset) => preset.id !== 'all' || (status?.capability && Object.values(status.capability.channels || {}).some((ch: any) => ch.built)))
    .map((preset) => ({ id: preset.id, label: getSliceLabel(preset.id) })), [status]);
  const batchSliceGroups = useMemo(() => {
    const presets = getAllPresets()
      .filter((preset) => preset.viewType !== 'grouped_gallery')
      .filter((preset) => !status?.capability || checkSliceAvailability(preset, status.capability).available);
    const build = (label: string, ids: string[]) => ({
      label,
      sliceIds: ids.filter((id) => presets.some((preset) => preset.id === id)),
    });
    return [
      build('色彩类', presets.filter((preset) => preset.group === 'color').map((preset) => preset.id)),
      build('亮度类', presets.filter((preset) => preset.group === 'brightness').map((preset) => preset.id)),
      build('质量类', presets.filter((preset) => preset.group === 'quality_edge').map((preset) => preset.id)),
      build('尺寸风险', ['large_image', 'small_image']),
    ].filter((group) => group.sliceIds.length > 0);
  }, [status]);

  // 鈹€鈹€ Jobs from API (for JobPicker) 鈹€鈹€
  const { jobs, loading: jobsLoading, error: jobsError, reload: reloadJobs } = useJobs();

  // 鈹€鈹€ Load analysis status for current job 鈹€鈹€
  const loadStatus = useCallback(async (jid: string) => {
    if (!jid) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await fetchAnalysisStatus(jid);
      setStatus(s);
    } catch (e: any) {
      setStatusError(e.message);
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus(jobId);
  }, [jobId, loadStatus]);

  useEffect(() => {
    setExportCart(jobId ? loadExportCart(jobId) : DEFAULT_EXPORT_CART_STATE);
    setSelectedImageIds(new Set());
    setVisibleImagesBySlice({});
  }, [jobId]);

  useEffect(() => {
    if (jobId) saveExportCart(jobId, exportCart);
  }, [jobId, exportCart]);

  useEffect(() => {
    saveThumbnailQuality('analysis.thumbnailQuality', thumbnailQuality);
  }, [thumbnailQuality]);

  const handleVisibleImagesChange = useCallback((sliceId: string, images: ImageCardData[]) => {
    setVisibleImagesBySlice((prev) => ({ ...prev, [sliceId]: images }));
  }, []);

  const handleToggleImageSelection = useCallback((imageId: string) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  }, []);

  const getCurrentVisibleIds = useCallback(() => (
    uniqueIds(currentVisibleImages.map((image) => image.image_id || ''))
  ), [currentVisibleImages]);

  const handleSelectAllCurrent = useCallback(() => {
    const ids = getCurrentVisibleIds();
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, [getCurrentVisibleIds]);

  const handleInvertCurrent = useCallback(() => {
    const ids = getCurrentVisibleIds();
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, [getCurrentVisibleIds]);

  const handleSelectTopN = useCallback(() => {
    const n = Math.max(0, Math.floor(selectionTopN));
    const ids = getCurrentVisibleIds().slice(0, n);
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, [getCurrentVisibleIds, selectionTopN]);

  const handleAddCartItem = useCallback((item: ReturnType<typeof makeExportCartItem>) => {
    if (item.image_ids.length === 0) return;
    setExportCart((prev) => ({ ...prev, items: [...prev.items, item] }));
    setShowExportPanel(true);
  }, []);

  // ── Export Settings Dialog ──────────────────────────────────
  const [dialogConfig, setDialogConfig] = useState<{
    defaultName: string;
    imageIds: string[];
    sliceIds?: string[];
    source: 'current_slice' | 'selected_images' | 'multi_slice_separate';
    topN?: number;
  } | null>(null);

  const handleDialogConfirm = useCallback((settings: { folderName: string; renameMode: ExportRenameMode; renameTemplate: string; skipDuplicates: boolean }) => {
    if (!dialogConfig) return;
    const item = makeExportCartItem({
      name: dialogConfig.defaultName,
      source: dialogConfig.source,
      image_ids: dialogConfig.imageIds,
      slice_ids: dialogConfig.sliceIds,
      top_n: dialogConfig.topN,
      folder_name: settings.folderName,
      rename_mode: settings.renameMode,
      rename_template: settings.renameMode === 'template' ? settings.renameTemplate : undefined,
      skip_duplicates: settings.skipDuplicates,
    });
    handleAddCartItem(item);
    setDialogConfig(null);
  }, [dialogConfig, handleAddCartItem]);

  const resolveCachedSliceImageIds = useCallback((sliceId: string) => {
    return uniqueIds((visibleImagesBySlice[sliceId] || []).map((image) => image.image_id || ''));
  }, [visibleImagesBySlice]);

  const handleAddCurrentSlice = useCallback((topN = 0) => {
    const cachedIds = resolveCachedSliceImageIds(activeSlice);
    const visibleIds = uniqueIds(currentVisibleImages.map((image) => image.image_id || ''));
    const ids = cachedIds.length > 0 ? cachedIds : visibleIds;
    const scopedIds = topN > 0 ? ids.slice(0, topN) : ids;
    setDialogConfig({
      defaultName: `${getSliceLabel(activeSlice)}${topN > 0 ? `_top${topN}` : ''}`,
      imageIds: scopedIds,
      sliceIds: [activeSlice],
      source: topN > 0 ? 'slice_top_n' : 'current_slice',
      topN: topN > 0 ? topN : undefined,
    });
  }, [activeSlice, currentVisibleImages, resolveCachedSliceImageIds]);

  const handleAddSelectedImages = useCallback(() => {
    setDialogConfig({
      defaultName: `selected_${selectedImageIds.size}张`,
      imageIds: Array.from(selectedImageIds),
      sliceIds: [activeSlice],
      source: 'selected_images',
    });
  }, [activeSlice, selectedImageIds]);

  const handleAddBatchGroup = useCallback((label: string, sliceIds: string[]) => {
    const topN = exportBatchTopN;
    const items = sliceIds
      .map((sliceId) => {
        const ids = resolveCachedSliceImageIds(sliceId);
        const scopedIds = topN > 0 ? ids.slice(0, topN) : ids;
        if (scopedIds.length === 0) return null;
        const sliceLabel = getSliceLabel(sliceId);
        return {
          defaultName: sanitizeFolderName(`${sliceLabel}${topN > 0 ? `_top${topN}` : ''}`),
          imageIds: scopedIds,
          sliceIds: [sliceId],
          source: 'multi_slice_separate' as const,
          topN: topN > 0 ? topN : undefined,
        };
      })
      .filter(Boolean);
    items.forEach((cfg) => {
      if (!cfg) return;
      setDialogConfig(cfg);
    });
  }, [exportBatchTopN, resolveCachedSliceImageIds]);

  // Edit cart item
  const handleEditItem = useCallback((id: string, settings: { folderName: string; renameMode: ExportRenameMode; renameTemplate: string; skipDuplicates: boolean }) => {
    setExportCart((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === id
          ? {
              ...item,
              folder_name: settings.folderName,
              rename_mode: settings.renameMode,
              rename_template: settings.renameMode === 'template' ? settings.renameTemplate : undefined,
              skip_duplicates: settings.skipDuplicates,
            }
          : item
      ),
    }));
  }, []);

  const handleExportCart = useCallback(async () => {
    if (!jobId || exportCart.items.length === 0) return;
    setExporting(true);
    setExportResult(null);
    const lines: string[] = [];
    const seen = new Set<string>();

    try {
      if (exportCart.merge_mode === 'single_folder') {
        let mergedIds = exportCart.items.flatMap((item) => item.image_ids);
        if (exportCart.dedupe_across_items) mergedIds = mergedIds.filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        const payload: AnalysisExportPayload = {
          mode: 'explicit_images',
          export_name: 'analysis_export_cart',
          output_dir: exportCart.output_dir || undefined,
          image_ids: mergedIds,
          folder_mode: 'single',
          copy_mode: 'copy_originals',
          source_reason: 'cart_item',
          rename_mode: exportCart.rename_mode,
          rename_template: exportCart.rename_template,
          slice_name: '导出队列',
          export_folder_name: '导出队列',
        };
        const result = await exportAnalysis(jobId, payload);
        lines.push(`合并导出完成：${result.copied_count} 张 -> ${result.export_dir}`);
        if (result.warnings.length > 0) lines.push(`警告：${result.warnings.length} 条`);
      } else {
        for (const item of exportCart.items) {
          let ids = item.image_ids;
          if (exportCart.dedupe_across_items) ids = ids.filter((id) => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
          if (ids.length === 0) {
            lines.push(`${item.name}：去重后无图片，已跳过`);
            continue;
          }
          const result = await exportAnalysis(jobId, {
            mode: 'explicit_images',
            export_name: item.folder_name,
            output_dir: exportCart.output_dir || undefined,
            image_ids: ids,
            slice_ids: item.slice_ids,
            folder_mode: 'single',
            copy_mode: item.copy_mode,
            source_reason: 'cart_item',
            rename_mode: exportCart.rename_mode,
            rename_template: exportCart.rename_template,
            slice_name: item.name,
            export_folder_name: item.folder_name,
          });
          lines.push(`${item.name}：${result.copied_count} 张 -> ${result.export_dir}`);
          if (result.warnings.length > 0) lines.push(`${item.name} 警告：${result.warnings.length} 条`);
        }
      }
      setExportResult(lines.join('\n'));
    } catch (e: any) {
      setExportResult(`导出失败：${e.message}`);
    } finally {
      setExporting(false);
    }
  }, [exportCart, jobId]);

  // 鈹€鈹€ Select a job 鈹€鈹€
  const handleSelectJob = useCallback((jid: string) => {
    const trimmed = jid.trim();
    if (!trimmed) return;
    const url = new URL(window.location.href);
    url.searchParams.set('job_id', trimmed);
    window.history.replaceState({}, '', url.toString());
    setJobId(trimmed);
    setActiveViewChannel(null);
    setBuildError(null);
    setActiveSlice('all');
    setViewMode('inspection');
  }, []);

  // 鈹€鈹€ Build channel 鈹€鈹€
  const handleBuild = useCallback(async (channelKey: string) => {
    if (!jobId) return;
    setBuilding((p) => ({ ...p, [channelKey]: true }));
    setBuildError(null);
    try {
      await buildAnalysisChannel(jobId, channelKey, false);
      await loadStatus(jobId);
    } catch (e: any) {
      setBuildError(`鏋勫缓 ${channelKey} 澶辫触: ${e.message}`);
    } finally {
      setBuilding((p) => ({ ...p, [channelKey]: false }));
    }
  }, [jobId, loadStatus]);

  // 鈹€鈹€ Channel entries for panels 鈹€鈹€
  const getPanelChannels = (group: PanelGroup): PanelChannelEntry[] => {
    const capData = status?.capability?.channels ?? {};
    return group.channels.map((chKey) => ({
      key: chKey,
      capability: capData[chKey] as ChannelCapability | undefined,
      building: building[chKey] ?? false,
    }));
  };

  // 鈹€鈹€ Computed 鈹€鈹€
  const totalBuilt = status?.capability?.total_built ?? 0;
  const totalBuildable = status?.capability?.total_buildable ?? PANEL_GROUPS.length;
  const hasJob = !!jobId;

  /* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?Render 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/
  return (
    <div style={styles.page}>
      <PageHeader
        title="分析通道"
        subtitle="图片巡检：按亮度、色彩、质量和文件特征快速浏览图片"
      />

      <div style={styles.content}>
        {/* 鈹€鈹€ No job selected: JobPicker 鈹€鈹€ */}
        {!hasJob && (
          <Card title="选择分析任务" style={{ maxWidth: 640, margin: '0 auto' }}>
            <JobPicker
              jobs={jobs}
              loading={jobsLoading}
              error={jobsError}
              onSelect={handleSelectJob}
              onReload={reloadJobs}
            />
          </Card>
        )}

        {/* 鈹€鈹€ Job selected: analysis dashboard 鈹€鈹€ */}
        {hasJob && (
          <>
            {/* Job info bar */}
            <Card variant="elevated" style={{ marginBottom: 16 }}>
              <div style={styles.jobBar}>
                <div style={styles.jobInfo}>
                  <span style={styles.jobLabel}>当前任务</span>
                  <code style={styles.jobId}>{jobId}</code>
                </div>
                <div style={styles.jobSummary}>
                  <Badge variant={statusLoading ? 'default' : totalBuilt === totalBuildable ? 'success' : 'warning'}>
                    {statusLoading ? '加载中...' : `${totalBuilt}/${totalBuildable} 通道已构建`}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setJobId('');
                    setStatus(null);
                    setActiveViewChannel(null);
                    setBuildError(null);
                    setActiveSlice('all');
                    setViewMode('inspection');
                    const url = new URL(window.location.href);
                    url.searchParams.delete('job_id');
                    window.history.replaceState({}, '', url.toString());
                  }}
                >
                  切换任务
                </Button>
              </div>
            </Card>

            {/* Build error */}
            {buildError && (
              <div style={styles.buildErrorBanner}>
                错误：{buildError}
              </div>
            )}

            {/* View toggle + action bar */}
            <div style={styles.viewToggleRow}>
              <Button
                variant={viewMode === 'inspection' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('inspection')}
                title="按亮度、色彩、质量等切片浏览图片"
              >
                图片巡检
              </Button>
              <Button
                variant={viewMode === 'raw-data' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('raw-data')}
                title="查看完整字段表格和高级排序"
              >
                原始数据
              </Button>
              {viewMode === 'raw-data' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDebug((d) => !d)}
                >
                  {showDebug ? '关闭 Debug' : 'Debug 视图'}
                </Button>
              )}
              <div style={{ flex: 1 }} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowExportPanel((p) => !p)}
                title="加入导出队列并统一导出原图"
              >
                导出
              </Button>
              <Button variant="ghost" size="sm" onClick={() => loadStatus(jobId)}>
                刷新
              </Button>
            </div>

            {/* Loading */}
            {statusLoading && (
              <LoadingState text="加载分析状态..." />
            )}

            {/* Error */}
            {statusError && !statusLoading && (
              <ErrorState
                title="加载失败"
                message={statusError}
                onRetry={() => loadStatus(jobId)}
              />
            )}

            {/* Main content */}
            {!statusLoading && !statusError && (
              <>
                {viewMode === 'inspection' && status && (
                  <>
                    {/* Slice bar */}
                    <InspectionSliceBar
                      activeSlice={activeSlice}
                      onSelectSlice={setActiveSlice}
                      capability={status?.capability ?? null}
                    />

                    {/* P11-001R: Export cart */}
                    {showExportPanel && (
                      <>
                        <div style={styles.exportQuickRow}>
                          <span style={styles.exportQuickLabel}>
                            当前切片：{getSliceLabel(activeSlice)} · 可见 {currentVisibleImages.length} 张 · 已选 {selectedCount} 张
                          </span>
                          <Button variant="ghost" size="sm" onClick={handleSelectAllCurrent} disabled={currentVisibleImages.length === 0}>
                            全选当前结果
                          </Button>
                          <Button variant="ghost" size="sm" onClick={handleInvertCurrent} disabled={currentVisibleImages.length === 0}>
                            反选当前结果
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setSelectedImageIds(new Set())} disabled={selectedCount === 0}>
                            清空选择
                          </Button>
                          <span style={styles.exportQuickLabel}>选择前</span>
                          <input
                            type="number"
                            min={1}
                            max={currentVisibleImages.length || 9999}
                            value={selectionTopN}
                            onChange={(event) => setSelectionTopN(Number(event.target.value))}
                            style={styles.compactNumberInput}
                          />
                          <Button variant="ghost" size="sm" onClick={handleSelectTopN} disabled={currentVisibleImages.length === 0}>
                            选择前 N 张
                          </Button>
                          <Button variant="ghost" size="sm" onClick={handleAddSelectedImages} disabled={selectedCount === 0}>
                            选中图片加入队列
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleAddCurrentSlice(0)} disabled={currentVisibleImages.length === 0}>
                            当前切片全部加入队列
                          </Button>
                          <span style={styles.exportQuickLabel}>缩略图大小</span>
                          <select
                            value={thumbnailQuality}
                            onChange={(event) => setThumbnailQuality(event.target.value as ThumbnailQuality)}
                            style={styles.compactSelect}
                          >
                            {THUMBNAIL_QUALITY_OPTIONS.map((item) => (
                              <option key={item.key} value={item.key}>{item.label}</option>
                            ))}
                          </select>
                        </div>

                        <div style={styles.exportQuickRow}>
                          <span style={styles.exportQuickLabel}>按大类批量加入</span>
                          <select
                            value={exportBatchTopN}
                            onChange={(event) => setExportBatchTopN(Number(event.target.value))}
                            style={styles.compactSelect}
                          >
                            <option value={1}>每个切片前 1 张</option>
                            <option value={5}>每个切片前 5 张</option>
                            <option value={20}>每个切片前 20 张</option>
                            <option value={0}>每个切片全部</option>
                          </select>
                          {batchSliceGroups.map((group) => (
                            <Button
                              key={group.label}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAddBatchGroup(group.label, group.sliceIds)}
                              disabled={!group.sliceIds.some((sliceId) => resolveCachedSliceImageIds(sliceId).length > 0)}
                            >
                              加入{group.label}
                            </Button>
                          ))}
                        </div>

                        <ExportRuleBuilder
                          sliceOptions={sliceOptions}
                          activeSlice={activeSlice}
                          resolveSliceImageIds={resolveCachedSliceImageIds}
                          onAddItem={handleAddCartItem}
                          onSelectIds={(ids) => {
                            setSelectedImageIds((prev) => {
                              const next = new Set(prev);
                              ids.forEach((id) => next.add(id));
                              return next;
                            });
                          }}
                        />

                        <ExportCartPanel
                          cart={exportCart}
                          exporting={exporting}
                          result={exportResult}
                          onCartChange={setExportCart}
                          onRemoveItem={(id) => setExportCart((prev) => ({
                            ...prev,
                            items: prev.items.filter((item) => item.id !== id),
                          }))}
                          onEditItem={handleEditItem}
                          onClear={() => {
                            setExportCart((prev) => ({ ...prev, items: [] }));
                            setExportResult(null);
                          }}
                          onExport={handleExportCart}
                        />

                        {dialogConfig && (
                          <ExportSettingsDialog
                            defaultName={dialogConfig.defaultName}
                            totalImages={dialogConfig.imageIds.length}
                            onConfirm={handleDialogConfirm}
                            onCancel={() => setDialogConfig(null)}
                          />
                        )}
                      </>
                    )}

                    {/* P10-003: viewType-based routing */}
                    {isGroupedGallery ? (
                      <DuplicateGroupGallery
                        jobId={jobId}
                        capability={status?.capability ?? null}
                        onSwitchToRawView={() => {
                          setViewMode('raw-data');
                        }}
                      />
                    ) : (
                      <ImageInspectionGrid
                        jobId={jobId}
                        activeSlice={activeSlice}
                        capability={status?.capability ?? null}
                        onBuildChannel={handleBuild}
                        onVisibleImagesChange={handleVisibleImagesChange}
                        selectedImageIds={selectedImageIds}
                        onToggleImageSelection={handleToggleImageSelection}
                        thumbnailQuality={thumbnailQuality}
                      />
                    )}
                  </>
                )}

                {viewMode === 'raw-data' && (
                  <>
                    {/* Raw data panel heading */}
                    <div style={styles.rawDataNote}>
                      <strong>原始数据 / 高级排序</strong>
                      <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-muted, #888)' }}>
                        这里保留完整字段、排序和筛选，适合排查数据或精确定位。普通巡检请回到图片巡检。
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => setViewMode('inspection')}>
                        图片巡检
                      </Button>
                    </div>

                    {/* Channel Panels */}
                    <div style={styles.panelsSection}>
                      {PANEL_GROUPS.map((group) => {
                        const channels = getPanelChannels(group);
                        if (group.key === 'modelPlugins') {
                          return (
                            <PluginPanel
                              key={group.key}
                              plugins={status?.plugin_channels}
                            />
                          );
                        }
                        return (
                          <ChannelPanel
                            key={group.key}
                            panelKey={group.key}
                            title={group.title}
                            description={group.description}
                            icon={group.icon}
                            channels={channels}
                            showDebug={showDebug}
                            onBuild={handleBuild}
                            onViewData={(chKey) => {
                              setActiveViewChannel((prev) => prev === chKey ? null : chKey);
                            }}
                            activeViewChannel={activeViewChannel}
                          />
                        );
                      })}
                    </div>

                    {/* Active data viewer */}
                    {activeViewChannel === 'duplicate_groups' && (
                      <DuplicateGroupsView
                        jobId={jobId}
                        isBuilt={!!(status?.capability?.channels?.duplicate_groups?.built)}
                        onClose={() => setActiveViewChannel(null)}
                      />
                    )}
                    {activeViewChannel && activeViewChannel !== 'duplicate_groups' && (
                      <ChannelDataViewer
                        channelKey={activeViewChannel}
                        jobId={jobId}
                        showDebug={showDebug}
                        onClose={() => setActiveViewChannel(null)}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div style={{ height: 32 }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '0 32px',
    maxWidth: 1100,
    margin: '0 auto',
    width: '100%',
  },
  content: {
    // content area
  },
  jobBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  jobInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  jobLabel: {
    fontSize: 12,
    color: 'var(--text-muted, #888)',
    fontWeight: 600,
  },
  jobId: {
    fontSize: 13,
    color: 'var(--accent, #7c9bff)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  jobSummary: {
    flexShrink: 0,
  },
  buildErrorBanner: {
    marginBottom: 16,
    padding: '10px 14px',
    background: 'rgba(255,90,110,0.08)',
    border: '1px solid rgba(255,90,110,0.2)',
    borderRadius: 6,
    color: 'var(--danger, #ff5a6e)',
    fontSize: 12,
  },
  viewToggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  rawDataNote: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
    padding: '10px 14px',
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--text, #e0e0e8)',
    flexWrap: 'wrap',
  },
  exportQuickRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    marginBottom: 12,
    background: 'var(--surface, #1e1e2e)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-md, 8px)',
    flexWrap: 'wrap',
  },
  exportQuickLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text, #e0e0e8)',
    marginRight: 4,
  },
  compactSelect: {
    padding: '5px 8px',
    fontSize: 12,
    background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: 'var(--text, #e0e0e8)',
    fontFamily: 'inherit',
  },
  compactNumberInput: {
    width: 72,
    padding: '5px 8px',
    fontSize: 12,
    background: 'var(--bg, #12121a)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: 'var(--text, #e0e0e8)',
    fontFamily: 'inherit',
  },
  panelsSection: {
    marginBottom: 16,
  },
};
