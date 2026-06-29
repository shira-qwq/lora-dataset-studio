/* HomeView — 项目列表 (v3: 显示所有 jobs + 重试)
 *
 * - 显示已完成、运行中、失败的所有项目
 * - 已完成: 进入画板
 * - 失败/中断: 重试按钮
 * - 运行中: 查看进度
 */

const HomeView = {
  async render(container) {
    container.innerHTML = '<div style="padding:24px;color:var(--text-muted)">Loading jobs...</div>';

    // Top bar
    const topbar = document.createElement('div');
    topbar.style.cssText = 'height:56px;padding:0 20px;background:var(--bg-elev);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px';
    topbar.innerHTML = `
      <div style="font-size:16px;font-weight:600;color:var(--text)">📁 Cluster Organizer</div>
      <div style="flex:1"></div>
      <div data-test="theme-picker-container"></div>
    `;
    // Add React links
    const reactAnalysisLink = document.createElement('a');
    reactAnalysisLink.href = '/react/analysis/';
    reactAnalysisLink.textContent = '⚡ Analysis (React)';
    reactAnalysisLink.style.cssText = 'padding:4px 10px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:11px;text-decoration:none';
    topbar.appendChild(reactAnalysisLink);

    const reactNewLink = document.createElement('a');
    reactNewLink.href = '/react/new-analysis/';
    reactNewLink.textContent = '＋ New Analysis V2 (React)';
    reactNewLink.style.cssText = 'padding:4px 10px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:11px;text-decoration:none;font-weight:600';
    topbar.appendChild(reactNewLink);

    const reactOrganizeLink = document.createElement('a');
    reactOrganizeLink.href = '/react/organize/';
    reactOrganizeLink.textContent = '⚛️ Organize V2 (React)';
    reactOrganizeLink.style.cssText = 'padding:4px 10px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:11px;text-decoration:none';
    topbar.appendChild(reactOrganizeLink);
    container.innerHTML = '';
    container.style.cssText = 'height:100vh;overflow:hidden;background:var(--bg);display:flex;flex-direction:column';
    container.appendChild(topbar);
    ThemePicker.render(topbar.querySelector('[data-test="theme-picker-container"]'));

    const main = document.createElement('div');
    main.style.cssText = 'flex:1;overflow-y:auto;padding:24px;max-width:1200px;margin:0 auto;width:100%';
    container.appendChild(main);

    // New analysis card
    const newCard = document.createElement('div');
    newCard.style.cssText = `
      padding:24px;background:var(--bg-elev);border:2px dashed var(--border);
      border-radius:12px;text-align:center;cursor:pointer;transition:all 0.2s;margin-bottom:24px;
    `;
    newCard.innerHTML = `
      <div style="font-size:36px;color:var(--accent);margin-bottom:8px">＋</div>
      <div style="font-size:15px;font-weight:600;color:var(--text)">新建分析</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px">选择文件夹开始聚类分析</div>
    `;
    newCard.onmouseover = () => { newCard.style.borderColor = 'var(--accent)'; };
    newCard.onmouseout = () => { newCard.style.borderColor = 'var(--border)'; };
    newCard.onclick = () => App.switchView('new-analysis');
    newCard.setAttribute('data-test', 'btn-new-analysis');
    main.appendChild(newCard);

    const sectionTitle = document.createElement('div');
    sectionTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px';
    sectionTitle.textContent = '所有项目';
    main.appendChild(sectionTitle);

    // Load jobs (includes both in-memory and from disk)
    let jobs = [];
    try {
      const resp = await fetch(apiBase() + '/jobs');
      const data = await resp.json();
      jobs = data.jobs || [];
    } catch (e) {
      main.appendChild(ce('div', `无法连接后端: ${e.message}`, { color: 'var(--error)', padding: '20px' }));
      return;
    }

    if (!jobs.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:60px 20px;text-align:center;color:var(--text-muted)';
      empty.innerHTML = '还没有项目。点击上方"新建分析"开始。';
      main.appendChild(empty);
      return;
    }

    // Render job cards
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px';
    grid.setAttribute('data-test', 'job-grid');
    main.appendChild(grid);

    for (const job of jobs) {
      const card = await this._renderJobCard(job);
      grid.appendChild(card);
    }
  },

  async _renderJobCard(job) {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-elev);border:1px solid var(--border);border-radius:8px;overflow:hidden;transition:all 0.2s';
    card.setAttribute('data-test', 'job-card');
    card.setAttribute('data-job-id', job.id);
    card.setAttribute('data-status', job.status);

    // Status color
    const statusColors = {
      completed: 'var(--success)',
      failed: 'var(--error)',
      interrupted: 'var(--warning)',
      cancelled: 'var(--text-muted)',
      running: 'var(--accent)',
      queued: 'var(--accent)',
      cancelling: 'var(--warning)',
    };
    const statusLabels = {
      completed: '✓ 完成',
      failed: '✗ 失败',
      interrupted: '⚠ 中断',
      cancelled: '⊘ 取消',
      running: '⏳ 运行中',
      queued: '⋯ 排队',
      cancelling: '⋯ 取消中',
    };
    const statusColor = statusColors[job.status] || 'var(--text-muted)';
    const statusLabel = statusLabels[job.status] || job.status;

    const project = job.output_folder ? job.output_folder.split(/[\\\/]/).pop() : job.id;
    const outputPath = job.output_folder || '';
    const stage = job.stage || '';
    const progress = job.progress !== undefined ? Math.round(job.progress * 100) : 0;

    card.innerHTML = `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;background:var(--bg)">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor}"></span>
        <span style="flex:1;font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escape(project)}">${escape(project)}</span>
        <span style="font-size:11px;color:${statusColor};font-weight:500">${statusLabel}</span>
      </div>
      <div style="padding:12px">
        <div style="font-size:11px;color:var(--text-muted);font-family:monospace;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escape(outputPath)}">${escape(outputPath || '—')}</div>
        ${stage && job.status === 'running' ? `
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">阶段: ${escape(stage)} (${progress}%)</div>
          <div style="height:4px;background:var(--bg);border-radius:2px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;background:var(--accent);width:${progress}%;transition:width 0.3s"></div>
          </div>
        ` : ''}
        ${job.error ? `
          <div style="font-size:11px;color:var(--error);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escape(job.error)}">${escape(job.error)}</div>
        ` : ''}
        <div style="display:flex;gap:6px;margin-top:8px">
          ${job.status === 'completed' ? `
            <button data-act="open" style="flex:1;padding:5px;background:var(--accent);color:var(--on-accent);border:none;border-radius:3px;cursor:pointer;font-size:12px">📂 整理</button>
            <button data-act="analysis" style="padding:5px 8px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px">📊 分析</button>
            <button data-act="organize-v2" style="padding:5px 8px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px">⚛️ V2</button>
            <button data-act="rerun" style="padding:5px 8px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px">↻ 重跑</button>
          ` : job.status === 'running' || job.status === 'queued' ? `
            <button data-act="view" style="flex:1;padding:5px;background:var(--accent);color:var(--on-accent);border:none;border-radius:3px;cursor:pointer;font-size:12px">⏳ 查看进度</button>
          ` : `
            <button data-act="restart" style="flex:1;padding:5px;background:var(--accent);color:var(--on-accent);border:none;border-radius:3px;cursor:pointer;font-size:12px">↻ 重试</button>
            <button data-act="viewlog" style="padding:5px 10px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px">📋 查日志</button>
          `}
        </div>
      </div>
    `;

    card.onmouseover = () => card.style.borderColor = 'var(--accent)';
    card.onmouseout = () => card.style.borderColor = 'var(--border)';

    // Wire up actions
    card.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'open') {
        JobStore.setActive(job.id);
        App.switchView('organize', { jobId: job.id });
      } else if (act === 'analysis') {
        JobStore.setActive(job.id);
        App.switchView('analysis', { jobId: job.id });
      } else if (act === 'organize-v2') {
        window.open('/react/organize/?job_id=' + encodeURIComponent(job.id), '_blank');
      } else if (act === 'rerun') {
        const ok = await Confirm.ask('重新聚类', '将用相同配置重新分析，是否继续？', { yesText: '开始' });
        if (!ok) return;
        try {
          const r = await fetch(apiBase() + '/jobs/' + encodeURIComponent(job.id) + '/restart', { method: 'POST' });
          const d = await r.json();
          if (r.ok && d.job_id) {
            App.switchView('progress', { jobId: d.job_id });
          } else {
            Toast.error('启动失败: ' + (d.detail || d.message));
          }
        } catch (e) { Toast.error('请求失败: ' + e.message); }
      } else if (act === 'view') {
        App.switchView('progress', { jobId: job.id });
      } else if (act === 'restart') {
        try {
          const r = await fetch(apiBase() + '/jobs/' + encodeURIComponent(job.id) + '/restart', { method: 'POST' });
          const d = await r.json();
          if (r.ok && d.job_id) {
            Toast.success('已重新启动');
            App.switchView('progress', { jobId: d.job_id });
          } else {
            Toast.error('重启失败: ' + (d.detail || d.message));
          }
        } catch (e) { Toast.error('重启失败: ' + e.message); }
      } else if (act === 'viewlog') {
        App.switchView('progress', { jobId: job.id });
      }
    });

    // Load thumbnail (try to get first image, but async)
    this._tryLoadThumbnail(card, job);

    return card;
  },

  async _tryLoadThumbnail(card, job) {
    // For now, just show a placeholder
    // (Could be enhanced to fetch first image)
  }
};

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function ce(tag, html, styles = {}) {
  const el = document.createElement(tag);
  el.innerHTML = html;
  Object.assign(el.style, styles);
  return el;
}

window.HomeView = HomeView;
