import { useState } from 'react';

interface ImageThumbProps {
  filename: string;
  thumbUrl: string;
  clusterId: string;
  isSelected: boolean;
  aspectRatio?: number;
  /** P10-005C: image layout mode — adaptive-gallery = justified gallery */
  imageLayout?: 'cover-grid' | 'contain-grid' | 'packed-masonry' | 'adaptive-gallery';
  onSelect: (filename: string, shiftKey: boolean, ctrlKey: boolean) => void;
  onDragStart: (filename: string) => void;
}

export default function ImageThumb({
  filename, thumbUrl, isSelected, aspectRatio,
  imageLayout = 'cover-grid',
  onSelect, onDragStart,
}: ImageThumbProps) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);

  const ratio = naturalRatio ?? aspectRatio ?? 1;
  // Cap extreme ratios for layout stability
  const clampedRatio = Math.max(0.25, Math.min(ratio, 4));

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setNaturalRatio(img.naturalWidth / img.naturalHeight);
    }
    setLoaded(true);
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', filename);
        onDragStart(filename);
      }}
      onClick={(e) => onSelect(filename, e.shiftKey, e.ctrlKey || e.metaKey)}
      style={{
        width: '100%',
        overflow: 'hidden',
        borderRadius: 4,
        border: isSelected ? '2px solid #7c9bff' : '2px solid transparent',
        cursor: 'pointer',
        background: '#1e1e2e',
        transition: 'border-color 0.1s',
        position: 'relative',
      }}
    >
      {!thumbUrl ? (
        <div style={{
          width: '100%', aspectRatio: '1',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', fontSize: 9, color: '#e74c3c',
          padding: 4, textAlign: 'center', wordBreak: 'break-all',
        }}>
          <span>thumbUrl missing</span>
          <span style={{ marginTop: 2 }}>{filename}</span>
        </div>
      ) : error ? (
        <div style={{
          width: '100%', aspectRatio: '1',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', fontSize: 9, color: '#e74c3c',
          padding: 4, textAlign: 'center', wordBreak: 'break-all',
        }}>
          <span>🖼️</span>
          <span>{filename}</span>
          <span style={{ fontSize: 7, marginTop: 2, color: '#666' }}>
            {thumbUrl.substring(0, 50)}
          </span>
        </div>
      ) : (
        <div style={{
          width: '100%',
          aspectRatio: (imageLayout !== 'packed-masonry' && imageLayout !== 'adaptive-gallery') ? '1' : undefined,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <img
            src={thumbUrl}
            alt={filename}
            draggable={false}
            onLoad={handleImgLoad}
            onError={() => setError(true)}
            style={{
              width: '100%',
              height: (imageLayout !== 'packed-masonry' && imageLayout !== 'adaptive-gallery') ? '100%' : undefined,
              display: 'block',
              objectFit: imageLayout === 'cover-grid' ? 'cover' : (imageLayout === 'contain-grid' ? 'contain' : undefined),
              position: (imageLayout !== 'packed-masonry' && imageLayout !== 'adaptive-gallery') ? 'absolute' : undefined,
              top: (imageLayout !== 'packed-masonry' && imageLayout !== 'adaptive-gallery') ? 0 : undefined,
              left: (imageLayout !== 'packed-masonry' && imageLayout !== 'adaptive-gallery') ? 0 : undefined,
              aspectRatio: loaded && (imageLayout === 'packed-masonry' || imageLayout === 'adaptive-gallery') ? undefined : ((imageLayout !== 'packed-masonry' && imageLayout !== 'adaptive-gallery') ? undefined : String(clampedRatio)),
              opacity: loaded ? 1 : 0.6,
              transition: 'opacity 0.15s',
            }}
          />
        </div>
      )}

      {isSelected && (
        <div style={{
          position: 'absolute', top: 4, right: 4,
          width: 16, height: 16, borderRadius: '50%',
          background: '#7c9bff', color: '#fff',
          fontSize: 10, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontWeight: 700,
        }}>
          ✓
        </div>
      )}

      {/* Filename overlay on hover */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '2px 4px', background: 'rgba(0,0,0,0.6)',
        fontSize: 9, color: '#ccc', textAlign: 'center',
        opacity: 0, transition: 'opacity 0.15s',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
        className="thumb-filename"
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
      >
        {filename}
      </div>
    </div>
  );
}
