/* Canvas — 画板平移/缩放/auto-fit */

const Canvas = {
  state: { scale: 1, pan: { x: 0, y: 0 } },
  viewport: null,
  world: null,
  _onWheel: null,
  _onMouseDown: null,

  init(viewport) {
    this.viewport = viewport;
    this.world = viewport.querySelector('.canvas-world');
    this._bindEvents();
  },

  _bindEvents() {
    this._onWheel = (e) => {
      // Single-wheel zoom (no Ctrl needed)
      e.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // Trackpad pinch = small deltaY, mouse wheel = larger. Use sign and magnitude.
      const absDelta = Math.abs(e.deltaY);
      const step = absDelta < 20 ? 0.02 : 0.1;
      const delta = e.deltaY > 0 ? -step : step;
      this.zoomAt(cx, cy, delta);
    };
    this.viewport.addEventListener('wheel', this._onWheel, { passive: false });

    this._onMouseDown = (e) => {
      // Pan: mousedown on canvas bg (not on cluster block or thumb)
      if (e.target.closest('.cluster-block')) return;
      if (e.target.closest('.thumb')) return;
      if (e.button !== 0) return;
      // Skip pan if Ctrl/Cmd is held (used for box-select instead)
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const startPan = { ...this.state.pan };
      const onMove = (ev) => {
        this.state.pan.x = startPan.x + (ev.clientX - startX);
        this.state.pan.y = startPan.y + (ev.clientY - startY);
        this.applyTransform();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Box select if dragged with Ctrl
        // (handled in selection.js)
        if (Selection._boxSelecting) {
          Selection.endBoxSelect(e);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    this.viewport.addEventListener('mousedown', this._onMouseDown);
  },

  applyTransform() {
    if (!this.world) return;
    this.world.style.transform = `translate(${this.state.pan.x}px, ${this.state.pan.y}px) scale(${this.state.scale})`;
  },

  zoomAt(cx, cy, delta) {
    const oldScale = this.state.scale;
    const newScale = Math.max(0.25, Math.min(3, oldScale + delta));
    if (newScale === oldScale) return;
    // Anchor at (cx, cy)
    this.state.pan.x = cx - (cx - this.state.pan.x) * (newScale / oldScale);
    this.state.pan.y = cy - (cy - this.state.pan.y) * (newScale / oldScale);
    this.state.scale = newScale;
    this.applyTransform();
    if (this.onZoom) this.onZoom(this.state.scale);
  },

  zoomTo(scale) {
    const cx = this.viewport.clientWidth / 2;
    const cy = this.viewport.clientHeight / 2;
    const delta = scale - this.state.scale;
    this.zoomAt(cx, cy, delta);
  },

  reset() {
    this.state.scale = 1;
    this.state.pan = { x: 0, y: 0 };
    this.applyTransform();
  },

  fitToView(blocks, padding = 40) {
    if (!blocks || !blocks.length) { this.reset(); return; }
    // Compute bbox of all blocks in world coords
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    blocks.forEach(b => {
      const x = parseFloat(b.style.left) || 0;
      const y = parseFloat(b.style.top) || 0;
      const w = b.offsetWidth || 200;
      const h = b.offsetHeight || 200;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    });
    const w = maxX - minX, h = maxY - minY;
    const vw = this.viewport.clientWidth - padding * 2;
    const vh = this.viewport.clientHeight - padding * 2;
    const scaleX = vw / w, scaleY = vh / h;
    const scale = Math.max(0.25, Math.min(1, Math.min(scaleX, scaleY)));
    this.state.scale = scale;
    // Center
    this.state.pan.x = padding - minX * scale + (vw - w * scale) / 2;
    this.state.pan.y = padding - minY * scale + (vh - h * scale) / 2;
    this.applyTransform();
    if (this.onZoom) this.onZoom(this.state.scale);
  }
};

window.Canvas = Canvas;
