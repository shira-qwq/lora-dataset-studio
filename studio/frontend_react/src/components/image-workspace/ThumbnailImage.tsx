/**
 * ThumbnailImage — 共享缩略图组件
 *
 * 职责：
 * - 渲染缩略图 URL（通过 getThumbnailUrl）
 * - 支持 fit / cover 适配模式
 * - 加载中占位符
 * - 加载失败占位符
 *
 * 自身不管理展示数据逻辑，只负责图片渲染状态。
 * 默认适配模式为 fit。
 */
import { useState } from 'react';
import { getThumbnailUrl } from '../../api/client';
import type { FitMode } from './types';

export interface ThumbnailImageProps {
  jobId: string;
  imagePath: string;
  /** 缩略图尺寸（默认 240） */
  size?: number;
  /** 缓存刷新档位: small / medium / large */
  qualityKey?: string;
  /** 适配模式: fit=完整显示, cover=填满卡片（默认 fit） */
  fitMode?: FitMode;
  /** 可选 alt 文本 */
  alt?: string;
  /** 加载完成回调 */
  onLoad?: () => void;
}

export default function ThumbnailImage({
  jobId,
  imagePath,
  size = 240,
  qualityKey,
  fitMode = 'fit',
  alt = '',
  onLoad,
}: ThumbnailImageProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  const thumbUrl = getThumbnailUrl(jobId, imagePath, size, qualityKey);

  const ext = (alt || imagePath).split('.').pop()?.toLowerCase() || '';
  const isVector = ['svg', 'webp'].includes(ext);

  const objectFit = fitMode === 'cover' ? 'cover' : 'contain';

  return (
    <div style={styles.wrapper}>
      {/* img 始终渲染，浏览器加载进度不会被 display:none 阻止 */}
      <img
        src={thumbUrl}
        alt={alt}
        style={{
          ...styles.img,
          objectFit,
        }}
        loading="lazy"
        onLoad={() => {
          setImgLoaded(true);
          onLoad?.();
        }}
        onError={() => setThumbError(true)}
      />

      {/* 加载中占位（位于 img 下方层叠，不影响 img 加载） */}
      {!imgLoaded && !thumbError && (
        <div style={styles.placeholder}>
          <span style={styles.icon}>{isVector ? '🎨' : '🖼️'}</span>
          <span style={styles.hint}>加载中…</span>
        </div>
      )}

      {/* 加载失败占位 */}
      {thumbError && (
        <div style={styles.placeholder}>
          <span style={styles.icon}>{isVector ? '🎨' : '🖼️'}</span>
          <span style={styles.hint}>图片未加载</span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    width: '100%',
    aspectRatio: '4 / 3',
    overflow: 'hidden',
    background: 'var(--thumbnail-bg, #1a1a28)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'block',
    zIndex: 1,
  },
  placeholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    zIndex: 0,
    pointerEvents: 'none',
  },
  icon: {
    fontSize: 36,
    opacity: 0.5,
    lineHeight: 1,
  },
  hint: {
    fontSize: 10,
    color: 'var(--text-faint, #555)',
    opacity: 0.6,
  },
};
