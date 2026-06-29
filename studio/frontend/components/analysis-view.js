/* AnalysisView — 全局排序/筛选/分析页 (v4.5-ui)
 *
 * 第一版支持 Basic Metadata 排序:
 * - megapixels, short_side, long_side, aspect_ratio, clipping_ratio
 *
 * 不改变 cluster assignment.
 */

const AnalysisView = {
  async render(container, params = {}) {
    const jobId = params.jobId || (window.JobStore && JobStore.activeId);
    if (!jobId) {
      container.innerHTML = '<div style="padding:24px;color:var(--text-muted)">请先选择一个项目</div>';
      return;
    }

    container.style.cssText = 'height:100vh;overflow:hidden;background:var(--bg);display:flex;flex-direction:column';

    // Top bar
    const topbar = document.createElement('div');
    topbar.style.cssText = 'height:48px;padding:0 12px;background:var(--bg-elev);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0';
    topbar.innerHTML = `
      <button class="av-back" style="padding:4px 8px;background:transparent;border:none;color:var(--text-soft);cursor:pointer;font-size:14px">←</button>
      <span style="font-size:13px;font-weight:600;color:var(--text)">📊 分析视图</span>
      <span style="font-size:11px;color:var(--text-muted)">${escape(jobId)}</span>
      <span style="flex:1"></span>
      <span class="av-status" style="font-size:11px;color:var(--text-muted)">加载中...</span>
      <select class="av-sort" style="padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:11px;outline:none">
        <option value="">暂无排序字段</option>
      </select>
      <select class="av-order" style="padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:11px;outline:none">
        <option value="desc">↓ 降序</option>
        <option value="asc">↑ 升序</option>
      </select>
      <button class="av-refresh" style="padding:4px 8px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:11px">↻ 刷新</button>
    `;

    container.appendChild(topbar);
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:16px';
    container.appendChild(body);

    // Back button
    topbar.querySelector('.av-back').onclick = () => App.switchView('home');

    // Status element
    const statusEl = topbar.querySelector('.av-status');
    const sortSelect = topbar.querySelector('.av-sort');
    const orderSelect = topbar.querySelector('.av-order');

    let metadataAvailable = false;
    let records = [];

    async function loadMetadata() {
      statusEl.textContent = '加载中...';
      try {
        // First check status
        const statusResp = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId) + '/analysis/status');
        const status = await statusResp.json();

        if (!status.basic_metadata_ready) {
          statusEl.textContent = '⚠ Basic metadata not built';
          body.innerHTML = `
            <div style="padding:40px;text-align:center;color:var(--text-muted)">
              <div style="font-size:18px;margin-bottom:12px">📊</div>
              <div style="font-size:14px;font-weight:500;color:var(--text);margin-bottom:8px">Basic metadata analysis not built</div>
              <div style="font-size:12px;line-height:1.6">请先运行:<br>
                <code style="background:var(--bg);padding:2px 6px;border-radius:3px;font-size:11px">
                  python tools/build_basic_metadata_channel.py --job-output &lt;job_output&gt;
                </code>
              </div>
            </div>
          `;
          return;
        }

        // Load metadata
        const totalResp = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId) + '/analysis/metadata-summary?limit=1');
        const totalData = await totalResp.json();
        if (!totalData.ok) throw new Error('Failed to load metadata');

        const fullResp = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId) + '/analysis/metadata-summary?limit=' + totalData.total);
        const fullData = await fullResp.json();
        if (!fullData.ok) throw new Error('Failed to load full metadata');

        records = fullData.records || [];
        metadataAvailable = true;

        // Update sort dropdown
        const sortFields = [
          'megapixels', 'short_side', 'long_side', 'aspect_ratio',
          'clipping_ratio', 'overexposed_ratio', 'underexposed_ratio',
          'file_size_mb', 'width', 'height'
        ];
        const labels = {
          megapixels: 'Megapixels ↑',
          short_side: 'Short side ↑',
          long_side: 'Long side ↑',
          aspect_ratio: 'Aspect ratio ↑',
          clipping_ratio: 'Clipping ratio ↑',
          overexposed_ratio: 'Overexposed ↑',
          underexposed_ratio: 'Underexposed ↑',
          file_size_mb: 'File size ↑',
          width: 'Width ↑',
          height: 'Height ↑',
        };
        sortSelect.innerHTML = '<option value="">— 不排序 —</option>' +
          sortFields.map(f => `<option value="${f}">${labels[f] || f}</option>`).join('');

        statusEl.textContent = `${records.length} 张图片`;
        sortSelect.disabled = false;

        renderTable(null, 'desc');
      } catch (e) {
        statusEl.textContent = '⚠ 错误: ' + e.message;
        body.innerHTML = `<div style="padding:24px;color:var(--error)">加载失败: ${escape(e.message)}</div>`;
      }
    }

    function renderTable(sortField, sortOrder) {
      if (!metadataAvailable || !records.length) return;

      let data = [...records];

      if (sortField) {
        data.sort((a, b) => {
          const va = parseFloat(a[sortField]) || 0;
          const vb = parseFloat(b[sortField]) || 0;
          return sortOrder === 'desc' ? vb - va : va - vb;
        });
      }

      body.innerHTML = `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:var(--bg-elev)">
                <th style="padding:6px 8px;text-align:left;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:600">#</th>
                <th style="padding:6px 8px;text-align:left;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:600">Image</th>
                <th style="padding:6px 8px;text-align:right;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:600">Width</th>
                <th style="padding:6px 8px;text-align:right;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:600">Height</th>
                <th style="padding:6px 8px;text-align:right;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:600">MP</th>
                <th style="padding:6px 8px;text-align:right;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:600">Short</th>
                <th style="padding:6px 8px;text-align:right;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:600">Aspect</th>
                <th style="padding:6px 8px;text-align:center;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:600">Orient</th>
                <th style="padding:6px 8px;text-align:right;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:600">Clipping</th>
              </tr>
            </thead>
            <tbody>
              ${data.map((r, i) => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:4px 8px;color:var(--text-muted)">${i + 1}</td>
                  <td style="padding:4px 8px;color:var(--text);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escape(r.image_path || '')}">${escape(r.image_path || '')}</td>
                  <td style="padding:4px 8px;text-align:right;color:var(--text)">${r.width != null ? r.width : '—'}</td>
                  <td style="padding:4px 8px;text-align:right;color:var(--text)">${r.height != null ? r.height : '—'}</td>
                  <td style="padding:4px 8px;text-align:right;color:var(--text)">${r.megapixels != null ? r.megapixels.toFixed(2) : '—'}</td>
                  <td style="padding:4px 8px;text-align:right;color:var(--text)">${r.short_side != null ? r.short_side : '—'}</td>
                  <td style="padding:4px 8px;text-align:right;color:var(--text)">${r.aspect_ratio != null ? r.aspect_ratio.toFixed(4) : '—'}</td>
                  <td style="padding:4px 8px;text-align:center">
                    <span style="color:${r.orientation === 'portrait' ? 'var(--accent)' : r.orientation === 'landscape' ? 'var(--success)' : 'var(--text-muted)'}">
                      ${r.orientation || '—'}
                    </span>
                  </td>
                  <td style="padding:4px 8px;text-align:right;color:${r.clipping_ratio > 0.1 ? 'var(--error)' : 'var(--text)'}">
                    ${r.clipping_ratio != null ? (r.clipping_ratio * 100).toFixed(1) + '%' : '—'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div style="padding:8px 0;font-size:11px;color:var(--text-muted);text-align:center">
          共 ${data.length} 张图片
        </div>
      `;
    }

    // Sort change handler
    sortSelect.onchange = () => renderTable(sortSelect.value || null, orderSelect.value);
    orderSelect.onchange = () => renderTable(sortSelect.value || null, orderSelect.value);
    topbar.querySelector('.av-refresh').onclick = loadMetadata;

    await loadMetadata();
  }
};

window.AnalysisView = AnalysisView;
