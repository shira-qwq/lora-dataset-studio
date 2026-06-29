import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchMetadataSummary,
  fetchHistogramSummary,
  fetchQualityEdgeSummary,
} from '../../api/client';
import { getJobImages } from '../../api/jobWorkspace';
import type { AnalysisCapability } from '../../api/client';
import { resolvePreset, checkSliceAvailability, getSliceLabel } from '../../analysis/inspectionManifest';
import WorkspaceImageGrid from '../image-workspace/WorkspaceImageGrid';
import type { WorkspaceImageCardItem } from '../image-workspace/WorkspaceImageGrid';
import { resolveBadges, resolveMetrics, resolveHoverFields } from './ImageInspectionCard';
import type { ImageCardData } from './ImageInspectionCard';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Button from '../ui/Button';
import { writeHandoff, buildOrganizeUrl } from '../../analysis/handoff';
import { getStableImageId } from '../../analysis/exportCart';
import type { ThumbnailQuality } from '../image-workspace/thumbnailQuality';
import { thumbnailQualityToSize } from '../image-workspace/thumbnailQuality';

interface ImageInspectionGridProps {
  jobId: string;
  activeSlice: string;
  capability: AnalysisCapability | null;
  onBuildChannel?: (channelKey: string) => void;
  onVisibleImagesChange?: (sliceId: string, images: ImageCardData[]) => void;
  selectedImageIds?: Set<string>;
  onToggleImageSelection?: (imageId: string) => void;
  thumbnailQuality?: ThumbnailQuality;
}

function createFetchByChannel(
  channelKey: string,
  jobId: string,
  sortField?: string,
  sortOrder?: string,
  limit = 100,
): Promise<{ records: any[]; total: number }> {
  switch (channelKey) {
    case 'basic_metadata':
      return fetchMetadataSummary(jobId, sortField, sortOrder, limit);
    case 'histogram':
      return fetchHistogramSummary(jobId, sortField, sortOrder, undefined, limit);
    case 'quality_edge':
      return fetchQualityEdgeSummary(jobId, sortField, sortOrder, undefined, limit);
    default:
      return fetchMetadataSummary(jobId, undefined, undefined, limit);
  }
}

function getImagePath(record: any): string {
  return record.image_path || record.filename || record.path || '';
}

function getFilename(record: any): string {
  const path = getImagePath(record);
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

async function loadWithFallback(
  channelKey: string,
  jobId: string,
  sortField: string | undefined,
  sortOrder: string | undefined,
  limit: number,
): Promise<{ records: any[]; total: number }> {
  try {
    return await createFetchByChannel(channelKey, jobId, sortField, sortOrder, limit);
  } catch (error: any) {
    if (error.message?.includes('400') || error.message?.includes('Bad Request')) {
      return await createFetchByChannel(channelKey, jobId, undefined, undefined, limit);
    }
    throw error;
  }
}

export default function ImageInspectionGrid({
  jobId,
  activeSlice,
  capability,
  onBuildChannel,
  onVisibleImagesChange,
  selectedImageIds,
  onToggleImageSelection,
  thumbnailQuality = 'medium',
}: ImageInspectionGridProps) {
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limitRef = useRef(100);

  const preset = useMemo(() => resolvePreset(activeSlice) || null, [activeSlice]);
  const availability = useMemo(
    () => preset ? checkSliceAvailability(preset, capability) : null,
    [preset, capability],
  );
  const isAvailable = !!availability?.available;
  const channelKey = preset?.requiredChannel || 'basic_metadata';
  const presetKey = preset?.id ?? '';
  const sortField = preset?.sortBy?.field || undefined;
  const sortOrder = preset?.sortBy?.order || 'desc';

  const loadData = useCallback(async () => {
    if (!presetKey || !isAvailable) return;
    setLoading(true);
    setError(null);
    try {
      const data = await loadWithFallback(channelKey, jobId, sortField, sortOrder, limitRef.current);
      const mediaRefs = await getJobImages(jobId, thumbnailQualityToSize(thumbnailQuality)).catch(() => []);
      const mediaById = new Map(mediaRefs.map((ref) => [ref.imageId, ref]));
      const mediaByFilename = new Map(mediaRefs.map((ref) => [ref.filename, ref]));
      const enriched = (data.records || []).map((record) => {
        const stableId = getStableImageId(record);
        const ref = mediaById.get(stableId) || mediaByFilename.get(getFilename(record));
        return ref ? {
          ...record,
          image_id: ref.imageId,
          filename: ref.filename,
          thumbnail_url: ref.thumbnailUrl,
          original_url: ref.originalUrl,
          exists: ref.exists,
          missing_reason: ref.missingReason,
        } : record;
      });
      setRecords(enriched);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      setError(err.message || '加载失败');
      setRecords([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [channelKey, isAvailable, jobId, presetKey, sortField, sortOrder, thumbnailQuality]);

  useEffect(() => {
    limitRef.current = 100;
    loadData();
  }, [loadData]);

  const cardData: ImageCardData[] = useMemo(() => records.map((record) => ({
    image_id: getStableImageId(record),
    image_path: getImagePath(record),
    filename: getFilename(record),
    thumbnailUrl: record.thumbnail_url || null,
    originalUrl: record.original_url || null,
    exists: record.exists,
    missingReason: record.missing_reason || null,
    fields: record,
  })), [records]);

  useEffect(() => {
    onVisibleImagesChange?.(activeSlice, cardData);
  }, [activeSlice, cardData, onVisibleImagesChange]);

  const cardItems: WorkspaceImageCardItem[] = cardData.map((card, index) => ({
    key: `${card.image_id || card.image_path}-${index}`,
    data: card,
    badges: resolveBadges(card, preset?.cardBadges || []),
    metrics: resolveMetrics(card, preset?.cardSignals),
    hoverFields: resolveHoverFields(card, preset?.hoverFields || []),
    sliceReason: preset ? `当前命中「${preset.copy.label_zh}」切片` : undefined,
    rank: index + 1,
  }));

  if (preset && !isAvailable) {
    const missingBuiltChannel = preset.requiredChannel && !(capability?.channels?.[preset.requiredChannel]?.built);
    return (
      <EmptyState
        icon="□"
        title={missingBuiltChannel ? (preset.copy.unavailableReason || '需要先构建通道') : '当前切片暂不可用'}
        description={availability?.reason || '构建对应分析通道后，就可以按这个条件巡检图片。'}
        action={
          missingBuiltChannel && onBuildChannel ? (
            <Button variant="primary" size="sm" onClick={() => onBuildChannel(preset.requiredChannel)}>
              构建通道
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (!preset) {
    return (
      <EmptyState
        icon="□"
        title="请选择切片"
        description="先在上方切片栏选择一个巡检条件，再查看图片。"
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        title="图片巡检加载失败"
        message={error}
        onRetry={loadData}
      />
    );
  }

  return (
    <div style={styles.gridWrapper}>
      <WorkspaceImageGrid
        jobId={jobId}
        items={cardItems}
        total={total}
        loading={loading}
        headerLabel={`${getSliceLabel(activeSlice)} · ${total} 张`}
        headerHint="先看图；悬停或选中后在右侧查看命中原因。"
        thumbnailSize={thumbnailQualityToSize(thumbnailQuality)}
        thumbnailQualityKey={thumbnailQuality}
        onLoadMore={() => {
          limitRef.current += 100;
          loadData();
        }}
        loadMoreText={`加载更多 (${records.length}/${total})`}
        selectedImageIds={selectedImageIds}
        onToggleImageSelection={onToggleImageSelection}
      />

      {records.length > 0 && preset && (
        <div style={styles.handoffRow}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              writeHandoff({
                jobId,
                source: 'analysis_inspection',
                presetId: preset.id,
                presetLabel: preset.copy.label_zh,
                imageCount: records.length,
                imageRefs: cardData.map((card) => ({
                  filename: card.filename,
                  image_path: card.image_path,
                })),
                createdAt: new Date().toISOString(),
              });
              window.location.href = buildOrganizeUrl(jobId, preset.id);
            }}
          >
            在整理画板中查看 ({records.length} 张)
          </Button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  gridWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  handoffRow: {
    display: 'flex',
    justifyContent: 'center',
    padding: '4px 0 8px',
  },
};
