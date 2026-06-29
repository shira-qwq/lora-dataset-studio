/* Grid — 簇块和图片网格渲染 (v3)
 *
 * - 簇内可滚动 (max-height + overflow-y: auto)
 * - 簇头可拖动 (改变簇位置)
 * - 拖动手柄视觉提示
 */

const Grid = {
  // 用户自定义位置 (cluster_id -> {x, y})
  customPositions: {},
  customSizes: {},
  _storageVersion: 'v6',

  _positionKey(jobId) {
    return 'cluster_positions_' + this._storageVersion + '_' + jobId;
  },

  _sizeKey(jobId) {
    return 'cluster_sizes_' + this._storageVersion + '_' + jobId;
  },

  _getClusterSize(cid) {
    const raw = this.customSizes[String(cid)];
    if (!raw) return { width: null, height: null };
    if (typeof raw === 'number') return { width: raw, height: raw };
    if (typeof raw === 'object') {
      return {
        width: Number(raw.width) || null,
        height: Number(raw.height) || null
      };
    }
    return { width: null, height: null };
  },

  estimateGridHeight(displayCount, thumbSize, opts = {}) {
    const gap = opts.thumbGap ?? 4;
    const columnCount = Math.max(1, opts.columnCount ?? 4);
    const minGridHeight = opts.minGridHeight ?? 320;
    const rows = Math.max(1, Math.ceil(Math.max(0, displayCount) / columnCount));
    const thumbRowHeight = Math.max(
      thumbSize + 16,
      Math.round(thumbSize * (opts.thumbRatio ?? 1.45))
    );
    return Math.max(minGridHeight, rows * thumbRowHeight + Math.max(0, rows - 1) * gap + 8);
  },

  loadPositions(jobId) {
    try {
      const raw = localStorage.getItem(this._positionKey(jobId));
      this.customPositions = raw ? JSON.parse(raw) : {};
      const sizeRaw = localStorage.getItem(this._sizeKey(jobId));
      this.customSizes = sizeRaw ? JSON.parse(sizeRaw) : {};
    } catch (e) {
      this.customPositions = {};
      this.customSizes = {};
    }
  },

  savePositions(jobId) {
    try {
      localStorage.setItem(this._positionKey(jobId), JSON.stringify(this.customPositions));
      localStorage.setItem(this._sizeKey(jobId), JSON.stringify(this.customSizes));
    } catch (e) {}
  },

  estimateBlockHeight(cluster, thumbSize, opts = {}) {
    const blockWidth = opts.blockWidth || Math.max(thumbSize * 4 + 60, 380);
    const minHeight = opts.minHeight || 0;
    const gridMaxHeight = opts.gridMaxHeight || this.estimateGridHeight(
      Math.max(0, opts.imageCount || 0),
      thumbSize,
      { thumbGap: opts.thumbGap ?? 4, columnCount: 4, minGridHeight: opts.minGridHeight || 320 }
    );
    const maxDisplay = (opts.maxDisplayById && opts.maxDisplayById[String(cluster.id)]) || opts.maxDisplay || 60;
    const count = Math.max(cluster.count || 0, opts.imageCount || 0);
    const displayCount = Math.max(0, Math.min(count, maxDisplay));
    const gap = opts.thumbGap ?? 4;
    const headerHeight = 54;
    const gridHeight = displayCount > 0 ? gridMaxHeight : 0;
    const footerHeight = displayCount > 0 ? 34 : 18;
    return Math.max(180, headerHeight + gridHeight + footerHeight, minHeight);
  },

  computeLayout(clusters, thumbSize, opts = {}) {
    const defaultBlockWidth = Math.max(thumbSize * 4 + 60, 380);
    const blockGapX = opts.blockGapX ?? 32;
    const blockGapY = opts.blockGapY ?? 28;
    const maxCols = Math.max(1, opts.maxCols || 4);
    const cols = maxCols;
    const columnHeights = Array.from({ length: cols }, () => blockGapY);
    const positions = [];
    let maxX = 0;
    let maxY = 0;

    clusters.forEach((c) => {
      const cid = String(c.id);
      const custom = this.customPositions[cid];
      const size = this._getClusterSize(cid);
      const blockWidth = Math.max(defaultBlockWidth, size.width || defaultBlockWidth);
      const heightEstimate = this.estimateBlockHeight(c, thumbSize, {
        blockWidth,
        maxDisplayById: opts.maxDisplayById || {},
        imageCount: opts.imageCounts ? opts.imageCounts[cid] : 0,
        thumbGap: opts.thumbGap ?? 4,
        gridMaxHeight: opts.gridMaxHeight,
        minGridHeight: opts.minGridHeight || 320,
        minHeight: size.height || 0
      });

      let x;
      let y;
      if (custom) {
        x = custom.x;
        y = custom.y;
      } else {
        const col = columnHeights.indexOf(Math.min(...columnHeights));
        x = col * (defaultBlockWidth + blockGapX);
        y = columnHeights[col];
        columnHeights[col] = y + heightEstimate + blockGapY;
      }

      positions.push({
        id: c.id,
        x,
        y,
        width: blockWidth,
        height: heightEstimate
      });
      maxX = Math.max(maxX, x + blockWidth);
      maxY = Math.max(maxY, y + heightEstimate);
    });

    const worldWidth = Math.max(maxX + blockGapX, cols * defaultBlockWidth + (cols - 1) * blockGapX + blockGapX);
    const worldHeight = Math.max(maxY + blockGapY, Math.max(...columnHeights) + blockGapY);
    return { positions, blockWidth: defaultBlockWidth, cols, blockGapX, blockGapY, worldWidth, worldHeight };
  },

  _readBlockRect(block) {
    const x = parseFloat(block.style.left) || 0;
    const y = parseFloat(block.style.top) || 0;
    const width = block.offsetWidth || 200;
    const height = block.offsetHeight || 200;
    return { x, y, width, height, right: x + width, bottom: y + height };
  },

  _rectsOverlap(a, b, gap = 0) {
    return !(
      a.right + gap <= b.x ||
      b.right + gap <= a.x ||
      a.bottom + gap <= b.y ||
      b.bottom + gap <= a.y
    );
  },

  _computePushVector(moving, anchor, gap = 0) {
    const overlapX = Math.min(moving.right, anchor.right) - Math.max(moving.x, anchor.x);
    const overlapY = Math.min(moving.bottom, anchor.bottom) - Math.max(moving.y, anchor.y);
    if (overlapX <= 0 || overlapY <= 0) return null;

    if (overlapX < overlapY) {
      const movingCenterX = moving.x + moving.width / 2;
      const anchorCenterX = anchor.x + anchor.width / 2;
      return movingCenterX < anchorCenterX ? { dx: -(overlapX + gap), dy: 0 } : { dx: overlapX + gap, dy: 0 };
    }

    const movingCenterY = moving.y + moving.height / 2;
    const anchorCenterY = anchor.y + anchor.height / 2;
    return movingCenterY < anchorCenterY ? { dx: 0, dy: -(overlapY + gap) } : { dx: 0, dy: overlapY + gap };
  },

  resolveCollisions(blocks, opts = {}) {
    const list = Array.from(blocks || []);
    if (!list.length) {
      return { positions: {}, bounds: { width: 0, height: 0 }, changed: false };
    }

    const gap = opts.gap ?? 20;
    const padding = opts.padding ?? 24;
    const fixedIds = new Set((opts.fixedIds || []).map(id => String(id)));
    const rects = new Map();
    const order = [];
    const blockById = new Map();

    list.forEach(block => {
      const cid = String(block.dataset.cid);
      const rect = this._readBlockRect(block);
      rects.set(cid, rect);
      blockById.set(cid, block);
      order.push(cid);
    });

    const queue = fixedIds.size ? Array.from(fixedIds) : order.slice();
    const maxIterations = opts.maxIterations || Math.max(48, order.length * 12);
    let iterations = 0;
    let changed = false;

    while (queue.length && iterations < maxIterations) {
      const sourceId = queue.shift();
      const source = rects.get(sourceId);
      if (!source) continue;

      for (const otherId of order) {
        if (otherId === sourceId) continue;
        const other = rects.get(otherId);
        if (!other) continue;
        if (!this._rectsOverlap(source, other, gap)) continue;

        let moveId = sourceId;
        if (fixedIds.has(sourceId) && !fixedIds.has(otherId)) {
          moveId = otherId;
        } else if (fixedIds.has(sourceId) && fixedIds.has(otherId)) {
          continue;
        }
        const anchorId = moveId === sourceId ? otherId : sourceId;
        const moving = rects.get(moveId);
        const anchor = rects.get(anchorId);
        if (!moving || !anchor) continue;

        const push = this._computePushVector(moving, anchor, gap);
        if (!push) continue;

        moving.x += push.dx;
        moving.y += push.dy;
        moving.right = moving.x + moving.width;
        moving.bottom = moving.y + moving.height;
        rects.set(moveId, moving);
        queue.push(moveId);
        changed = true;
      }
      iterations += 1;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    rects.forEach(rect => {
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.right);
      maxY = Math.max(maxY, rect.bottom);
    });

    const shiftX = padding - minX;
    const shiftY = padding - minY;
    const positions = {};
    rects.forEach((rect, id) => {
      rect.x += shiftX;
      rect.y += shiftY;
      rect.right = rect.x + rect.width;
      rect.bottom = rect.y + rect.height;
      positions[id] = { x: rect.x, y: rect.y };
      const block = blockById.get(id);
      if (block) {
        block.style.left = rect.x + 'px';
        block.style.top = rect.y + 'px';
      }
    });

    return {
      positions,
      bounds: {
        width: Math.max(0, maxX + shiftX + padding),
        height: Math.max(0, maxY + shiftY + padding)
      },
      changed
    };
  },

  renderBlock(cluster, images, opts) {
    const { thumbSize, blockWidth, blockHeight, x, y, histogramLookup } = opts;
    const displayLimit = Number.isFinite(opts.maxDisplay) ? opts.maxDisplay : images.length;
    const displayImgs = images.slice(0, displayLimit);
    const hasMore = images.length > displayImgs.length || (cluster.count || 0) > displayImgs.length;
    const color = cluster.color || pickColor(cluster.id);
    const name = cluster.suggested_name || cluster.name || ('簇 ' + cluster.id);
    const label = String(name).substring(0, 40);
    const gap = 4;
    const gridMaxHeight = opts.gridMaxHeight || this.estimateGridHeight(displayImgs.length, thumbSize, {
      thumbGap: gap,
      columnCount: 4,
      minGridHeight: opts.minGridHeight || 320
    });

    const imgsHtml = displayImgs.map(img => {
      const path = (img.image_path || img.filename || '').replace(/\\/g, '/');
      // Look up histogram labels for this image
      const histRec = histogramLookup ? (histogramLookup[path] || histogramLookup[img.filename] || null) : null;
      const histLabels = histRec && histRec.labels ? String(histRec.labels) : '';
      return `<div class="thumb" data-filename="${escape(img.filename || '')}" data-cid="${cluster.id}" data-path="${encodeURIComponent(path)}" data-hlabels="${escape(histLabels)}" draggable="true" style="
        width:100%;margin:0 0 ${gap}px 0;
        background:var(--bg-deep);border-radius:3px;overflow:hidden;
        border:1.5px solid ${color};cursor:pointer;
        break-inside:avoid;display:block;
      ">
        <img class="thumb-img" data-src="${encodeURIComponent(path)}" loading="lazy" style="width:100%;height:auto;display:block">
        ${histLabels ? `<div class="hist-label-badge" style="padding:1px 4px;font-size:8px;color:var(--text-muted);background:var(--bg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-top:1px solid var(--border)">${escape(histLabels)}</div>` : ''}
      </div>`;
    }).join('');

    const moreHtml = hasMore ? `<button class="load-more" data-cid="${cluster.id}" style="
      background:transparent;border:1px dashed var(--border);color:var(--text-muted);
      padding:4px 10px;margin-top:8px;border-radius:3px;cursor:pointer;font-size:11px;
      width:100%;break-inside:avoid;
    ">加载更多 (+${(cluster.count || 0) - displayImgs.length} 张剩余)</button>` : '';

    return `<div class="cluster-block" data-cid="${cluster.id}" style="
      position:absolute;left:${x}px;top:${y}px;width:${blockWidth}px;min-height:${blockHeight || 0}px;
      background:var(--bg-elev);border:1px solid var(--border);border-radius:6px;
      padding:10px;box-sizing:border-box;
    ">
      <div class="cluster-header" style="
        display:flex;align-items:center;gap:6px;margin-bottom:8px;
        padding:4px 6px;margin: -10px -10px 8px -10px;
        background:var(--bg-deep);border-radius:6px 6px 0 0;
        cursor:move;
      ">
        <span class="drag-handle" data-cid="${cluster.id}" style="
          cursor:grab;color:var(--text-muted);font-size:11px;user-select:none;
        ">⠿</span>
        <span class="dot" style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span class="cluster-title" data-cid="${cluster.id}" data-test="cluster-title" style="
          font-size:13px;font-weight:600;color:var(--text);flex:1;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text;
        ">${escape(label)}</span>
        <span style="font-size:11px;color:var(--text-muted)">${cluster.count || 0}</span>
        <button class="cluster-fold" data-cid="${cluster.id}" title="折叠/展开" style="
          background:transparent;border:none;color:var(--text-muted);cursor:pointer;
          padding:0 4px;font-size:14px
        ">▾</button>
      </div>
      <div class="cluster-grid" style="
        display:block;column-count:4;column-gap:${gap}px;
        column-fill:auto;max-height:${gridMaxHeight}px;overflow-y:auto;overflow-x:hidden;padding-right:4px;
      ">
        ${imgsHtml}
      </div>
      <div class="cluster-resize" data-cid="${cluster.id}" title="拖拽调整大小" style="
        position:absolute;right:2px;bottom:2px;width:14px;height:14px;
        cursor:nwse-resize;border-right:2px solid ${color};border-bottom:2px solid ${color};
        opacity:0.7;touch-action:none;
      "></div>
      ${moreHtml}
    </div>`;
  }
};

function pickColor(id) {
  const colors = ['var(--cluster-1)', 'var(--cluster-2)', 'var(--cluster-3)'];
  const hash = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

window.Grid = Grid;
