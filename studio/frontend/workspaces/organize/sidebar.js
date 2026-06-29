/* Sidebar — 簇列表 (搜索 + 拖放目标) */

const Sidebar = {
  render(clusters, opts = {}) {
    const { onDrop, onSelect, onRename } = opts;
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width: 220px; flex-shrink: 0; background: var(--bg-elev);
      border-right: 1px solid var(--border); display: flex; flex-direction: column;
      height: 100%;
    `;
    wrap.setAttribute('data-test', 'sidebar');

    wrap.innerHTML = `
      <div style="padding:10px;border-bottom:1px solid var(--border)">
        <input type="text" data-test="cluster-search" placeholder="搜索簇..." style="
          width:100%;padding:5px 8px;background:var(--bg);
          border:1px solid var(--border);color:var(--text);
          border-radius:3px;font-size:12px;outline:none;
        ">
      </div>
      <div class="sb-list" style="flex:1;overflow-y:auto" data-test="cluster-list"></div>
    `;

    const list = wrap.querySelector('.sb-list');
    this._renderItems(list, clusters, onSelect);

    const searchInput = wrap.querySelector('[data-test="cluster-search"]');
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase();
      list.querySelectorAll('.sb-item').forEach(el => {
        const name = (el.dataset.name || '').toLowerCase();
        el.style.display = name.includes(q) ? '' : 'none';
      });
    };

    return wrap;
  },

  _renderItems(container, clusters, onSelect) {
    container.innerHTML = clusters.map(c => {
      const name = c.suggested_name || c.name || ('簇 ' + c.id);
      const color = c.color || getClusterColor(c.id);
      return `<div class="sb-item" data-cid="${c.id}" data-name="${escape(name)}" data-test="sidebar-item" style="
        display:flex;align-items:center;gap:8px;padding:8px 12px;
        border-bottom:1px solid var(--border);cursor:pointer;
        transition:background 0.1s;
      ">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span style="flex:1;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escape(name)}</span>
        <span style="font-size:10px;color:var(--text-muted)">${c.count || 0}</span>
      </div>`;
    }).join('');

    container.querySelectorAll('.sb-item').forEach(el => {
      el.onmouseover = () => { if (!el.classList.contains('drag-over')) el.style.background = 'var(--bg-elev)'; };
      el.onmouseout = () => { if (!el.classList.contains('drag-over')) el.style.background = ''; };
      el.onclick = () => {
        if (onSelect) onSelect(el.dataset.cid);
      };
    });
  },

  highlight(target) {
    document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('drag-over'));
    if (target) {
      target.classList.add('drag-over');
      target.style.background = 'var(--bg-elev)';
      target.style.outline = '2px solid var(--accent)';
    }
  },

  unhighlightAll() {
    document.querySelectorAll('.sb-item').forEach(el => {
      el.classList.remove('drag-over');
      el.style.background = '';
      el.style.outline = '';
    });
  }
};

function getClusterColor(id) {
  const colors = ['var(--cluster-1)', 'var(--cluster-2)', 'var(--cluster-3)'];
  const hash = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

window.Sidebar = Sidebar;
