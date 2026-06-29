/* Drag — 拖动图片到目标簇
 *
 * v3 关键改动:
 * - 拖动完成后调 OrganizerWorkspace._moveLocal() (本地更新 DOM，不调 API)
 * - 不再触发 Actions.moveToCluster (那是全局刷新)
 */

const Drag = {
  _dragging: false,
  _ghost: null,
  _moved: false,

  onThumbMouseDown(thumb, e) {
    if (e.button !== 0) return;
    const fn = thumb.dataset.filename;
    if (!fn) return;
    if (!SelectionStore.has(fn)) SelectionStore.select([fn]);
    this._dragging = true;
    this._moved = false;
    const startX = e.clientX, startY = e.clientY;
    this._createGhost(SelectionStore.getAll(), e.clientX, e.clientY);

    const onMove = (ev) => {
      if (!this._dragging) return;
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) {
        this._moved = true;
      }
      if (this._moved) {
        this._updateGhost(ev.clientX, ev.clientY);
        const target = Selection.findDropTarget(ev);
        if (target) {
          if (target.type === 'sidebar') {
            const item = document.querySelector(`.sb-item[data-cid="${target.cid}"]`);
            Sidebar.highlight(item);
          } else {
            Sidebar.unhighlightAll();
            const block = document.querySelector(`.cluster-block[data-cid="${target.cid}"]`);
            if (block) block.style.outline = '2px solid var(--accent)';
          }
        } else {
          Sidebar.unhighlightAll();
          document.querySelectorAll('.cluster-block').forEach(b => b.style.outline = '');
        }
      }
    };

    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      Sidebar.unhighlightAll();
      document.querySelectorAll('.cluster-block').forEach(b => b.style.outline = '');
      if (!this._dragging) return;
      this._dragging = false;
      this._removeGhost();
      if (!this._moved) return;
      const target = Selection.findDropTarget(ev);
      if (!target) return;
      if (String(target.cid) === String(thumb.dataset.cid)) {
        Toast.info('已在该簇', 1500);
        return;
      }
      // 关键改动：调 _moveLocal 而不是 Actions.moveToCluster
      if (window.OrganizerWorkspace && OrganizerWorkspace._moveLocal) {
        OrganizerWorkspace._moveLocal(SelectionStore.getAll(), target.cid);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  _createGhost(ids, x, y) {
    const g = document.createElement('div');
    g.style.cssText = `position:fixed;left:${x + 8}px;top:${y + 8}px;z-index:99999;background:var(--bg-elev);color:var(--text);border:1px solid var(--accent);border-radius:4px;padding:4px 8px;font-size:12px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.4)`;
    g.textContent = '移动 ' + ids.length + ' 张';
    document.body.appendChild(g);
    this._ghost = g;
  },

  _updateGhost(x, y) {
    if (this._ghost) {
      this._ghost.style.left = (x + 8) + 'px';
      this._ghost.style.top = (y + 8) + 'px';
    }
  },

  _removeGhost() {
    if (this._ghost) { this._ghost.remove(); this._ghost = null; }
  }
};

window.Drag = Drag;
