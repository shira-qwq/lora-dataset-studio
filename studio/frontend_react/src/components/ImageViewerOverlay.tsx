/**
 * ImageViewerOverlay — 统一大图查看器
 *
 * 功能：
 * - 顶层 fixed overlay，z-index 高于一切
 * - 点击背景关闭，点击图片不关闭
 * - ESC 关闭
 * - 滚轮缩放
 * - 拖拽平移
 * - 重置缩放 / 适应窗口
 * - 打开新图片时重置状态
 * - 不触发下层选中、拖拽、hover 事件
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface ImageViewerOverlayProps {
  src: string;
  filename?: string;
  onClose: () => void;
}

type DragState = { isDragging: boolean; startX: number; startY: number; imgX: number; imgY: number };

export default function ImageViewerOverlay({ src, filename, onClose }: ImageViewerOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<DragState>({ isDragging: false, startX: 0, startY: 0, imgX: 0, imgY: 0 });
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });

  // Reset on new src
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    scaleRef.current = 1;
    posRef.current = { x: 0, y: 0 };
    setImgLoaded(false);
  }, [src]);

  // Keyboard: ESC close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const fitToWindow = useCallback(() => {
    if (!imgRef.current || !imgLoaded) return;
    const img = imgRef.current;
    const parent = overlayRef.current;
    if (!parent) return;
    const pw = parent.clientWidth * 0.85;
    const ph = parent.clientHeight * 0.75;
    const iw = img.naturalWidth || pw;
    const ih = img.naturalHeight || ph;
    const s = Math.min(pw / iw, ph / ih, 1);
    setScale(s);
    setPosition({ x: 0, y: 0 });
    scaleRef.current = s;
    posRef.current = { x: 0, y: 0 };
  }, [imgLoaded]);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    scaleRef.current = 1;
    posRef.current = { x: 0, y: 0 };
  }, []);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.1, Math.min(20, scaleRef.current + delta));
    scaleRef.current = newScale;
    setScale(newScale);
  }, []);

  // Mouse drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      imgX: posRef.current.x,
      imgY: posRef.current.y,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const newPos = { x: dragRef.current.imgX + dx, y: dragRef.current.imgY + dy };
    posRef.current = newPos;
    setPosition(newPos);
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (dragRef.current.isDragging) {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current.isDragging = false;
    }
  }, []);

  // Background click = close
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  }, [onClose]);

  const handleImgLoad = useCallback(() => {
    setImgLoaded(true);
    if (imgRef.current) {
      setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  }, []);

  const pct = Math.round(scale * 100);

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: dragRef.current.isDragging ? 'grabbing' : 'default',
        userSelect: 'none',
      }}
    >
      {/* Top bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%)',
        zIndex: 2,
      }}>
        <div style={{ color: '#ccc', fontSize: 13 }}>
          {filename || 'Image'}
          {naturalSize.w > 0 && ` · ${naturalSize.w}×${naturalSize.h}`}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={fitToWindow} style={btnStyle} title="适应窗口">⊞ Fit</button>
          <button onClick={resetZoom} style={btnStyle} title="重置缩放">1:1</button>
          <span style={{ color: '#aaa', fontSize: 12, minWidth: 40, textAlign: 'center' }}>{pct}%</span>
          <button onClick={onClose} style={{ ...btnStyle, fontSize: 18, lineHeight: '16px' }} title="关闭 (ESC)">✕</button>
        </div>
      </div>

      {/* Image container */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        width: '100%',
        position: 'relative',
      }}>
        <img
          ref={imgRef}
          src={src}
          alt={filename || 'preview'}
          onLoad={handleImgLoad}
          onDragStart={(e) => e.preventDefault()}
          style={{
            maxWidth: '90%',
            maxHeight: '80%',
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            cursor: dragRef.current.isDragging ? 'grabbing' : 'grab',
            objectFit: 'contain',
            transition: dragRef.current.isDragging ? 'none' : 'transform 0.08s ease',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>,
    document.body
  );
}

const btnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 4,
  color: '#ddd',
  fontSize: 12,
  padding: '4px 10px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
