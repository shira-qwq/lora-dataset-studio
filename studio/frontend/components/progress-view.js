/* ProgressView — 进度页 (v3: 持久 log + 断线续)
 *
 * - SSE 订阅实时进度
 * - 断线后从 /jobs/{id}/log?offset= 读取历史
 * - 状态持久化：刷新页面能继续看 log
 * - 错误/中断时显示 "重试" 按钮
 */

const ProgressView = {
  _es: null,
  _jobId: null,
  _logOffset: 0,

  async render(container, params) {
    const jobId = params.jobId;
    if (!jobId) { App.switchView('home'); return; }
    this._jobId = jobId;
    this._logOffset = 0;

    container.style.cssText = 'height:100vh;overflow:hidden;background:var(--bg);display:flex;flex-direction:column';
    container.innerHTML = `
      <div style="padding:12px 16px;background:var(--bg-elev);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-shrink:0">
        <button id="pv-back" style="padding:5px 10px;background:transparent;border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer">← 首页</button>
        <div style="font-size:14px;font-weight:600;color:var(--text)">分析进度</div>
        <div style="font-size:11px;color:var(--text-muted);font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escape(jobId)}</div>
        <span id="pv-status-pill" style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg-elev);color:var(--text-muted)">初始化...</span>
      </div>

      <div style="flex:1;display:flex;padding:16px;gap:16px;overflow:hidden">
        <div style="flex:1;max-width:600px;background:var(--bg-elev);border:1px solid var(--border);border-radius:8px;padding:16px;display:flex;flex-direction:column" data-test="progress-view">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:12px">阶段</div>
          <div id="pv-stages" data-test="progress-stages" style="flex:1;overflow-y:auto"></div>
          <div style="margin-top:12px">
            <div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden">
              <div id="pv-bar" data-test="progress-bar" style="height:100%;background:var(--accent);width:0%;transition:width 0.3s"></div>
            </div>
            <div id="pv-status" style="margin-top:8px;font-size:12px;color:var(--text-muted)">等待事件...</div>
          </div>
          <div id="pv-actions" style="margin-top:12px;display:none;gap:8px">
            <button id="pv-restart" data-test="btn-restart" style="padding:6px 12px;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer;font-size:12px">↻ 重试</button>
            <button id="pv-discard" style="padding:6px 12px;background:transparent;border:1px solid var(--error);color:var(--error);border-radius:4px;cursor:pointer;font-size:12px">✗ 放弃</button>
          </div>
        </div>

        <div style="flex:1;background:var(--bg-elev);border:1px solid var(--border);border-radius:8px;padding:16px;display:flex;flex-direction:column;overflow:hidden">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:8px">
            日志
            <span id="pv-log-info" style="font-size:10px;color:var(--text-muted);font-weight:normal"></span>
          </div>
          <div id="pv-log" data-test="progress-log" style="flex:1;overflow-y:auto;font-size:11px;font-family:monospace;color:var(--text-soft);background:var(--bg);border-radius:3px;padding:8px;line-height:1.5;white-space:pre-wrap;word-break:break-all"></div>
        </div>
      </div>
    `;

    // Stages
    const STAGES = [
      { id: 'scan',       label: '扫描图片' },
      { id: 'preprocess', label: '预处理' },
      { id: 'assemble',   label: '特征装配' },
      { id: 'diagnose',   label: '特征诊断' },
      { id: 'umap',       label: 'UMAP 降维' },
      { id: 'cluster',    label: '聚类' },
      { id: 'name',       label: '命名' },
      { id: 'output',     label: '写产物' },
    ];
    container.querySelector('#pv-stages').innerHTML = STAGES.map(s =>
      `<div class="pv-stage" data-stage="${s.id}" style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;color:var(--text-muted)">
        <span class="pv-icon" style="display:inline-block;width:20px;text-align:center">○</span>
        <span>${s.label}</span>
      </div>`
    ).join('');

    container.querySelector('#pv-back').onclick = () => App.switchView('home');

    const setStage = (stage, status) => {
      const el = container.querySelector(`[data-stage="${stage}"]`);
      if (!el) return;
      const icon = el.querySelector('.pv-icon');
      if (status === 'done') {
        icon.textContent = '✓'; icon.style.color = 'var(--success)'; el.style.color = 'var(--text)';
      } else if (status === 'active') {
        icon.textContent = '▶'; icon.style.color = 'var(--accent)'; el.style.color = 'var(--text)';
      } else {
        icon.textContent = '○'; icon.style.color = 'var(--text-muted)';
      }
    };

    const setStatusPill = (text, color) => {
      const el = container.querySelector('#pv-status-pill');
      el.textContent = text;
      el.style.background = color || 'var(--bg-elev)';
      el.style.color = color === 'var(--success)' || color === 'var(--error)' ? '#fff' : 'var(--text-muted)';
    };

    const showActions = (show) => {
      container.querySelector('#pv-actions').style.display = show ? 'flex' : 'none';
    };

    // Load historical log first (from disk)
    await this._loadHistoricalLog(container);

    // Check current job status
    let currentStatus = null;
    try {
      const r = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId));
      if (r.ok) {
        const state = await r.json();
        currentStatus = state.status;
        // Apply current state to UI
        if (state.stage) {
          STAGES.forEach((s, i) => {
            if (s.id === state.stage) setStage(s.id, 'active');
            else if (i < STAGES.findIndex(x => x.id === state.stage)) setStage(s.id, 'done');
          });
        }
        if (state.progress !== undefined) {
          container.querySelector('#pv-bar').style.width = (state.progress * 100) + '%';
        }
        if (state.last_log) container.querySelector('#pv-status').textContent = state.last_log;
        if (state.status === 'completed') {
          setStatusPill('✓ 完成', 'var(--success)');
          STAGES.forEach(s => setStage(s.id, 'done'));
          container.querySelector('#pv-bar').style.width = '100%';
          container.querySelector('#pv-status').textContent = '完成! 跳转到画板...';
          setTimeout(() => App.switchView('organize', { jobId }), 1500);
          return;
        } else if (state.status === 'failed') {
          setStatusPill('✗ 失败', 'var(--error)');
          showActions(true);
        } else if (state.status === 'interrupted') {
          setStatusPill('⚠ 中断', 'var(--warning)');
          showActions(true);
        } else if (state.status === 'cancelled') {
          setStatusPill('⊘ 取消', 'var(--text-muted)');
          showActions(true);
        } else {
          setStatusPill('⏳ ' + (state.status || '运行中'), 'var(--accent)');
        }
      }
    } catch (e) {
      console.warn('status check failed', e);
    }

    // Wire up restart button
    container.querySelector('#pv-restart').onclick = async () => {
      try {
        const r = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId) + '/restart', { method: 'POST' });
        const d = await r.json();
        if (r.ok && d.job_id) {
          Toast.success('已重新启动');
          this.render(container, { jobId });
        } else {
          Toast.error('重启失败: ' + (d.detail || d.message));
        }
      } catch (e) { Toast.error('重启失败: ' + e.message); }
    };
    container.querySelector('#pv-discard').onclick = () => App.switchView('home');

    // If job is already done/failed, don't open SSE
    if (currentStatus && ['completed', 'failed', 'cancelled', 'interrupted'].includes(currentStatus)) {
      return;
    }

    // Open SSE for live updates
    this._openSSE(jobId, container, setStage, setStatusPill);
  },

  async _loadHistoricalLog(container) {
    // Read log from disk
    try {
      const r = await fetch(apiBase() + '/jobs/' + encodeURIComponent(this._jobId) + '/log?offset=0&limit=1000');
      if (r.ok) {
        const data = await r.json();
        const logEl = container.querySelector('#pv-log');
        if (data.lines && data.lines.length) {
          logEl.textContent = data.lines.join('\n') + '\n';
          this._logOffset = data.offset || 0;
          logEl.scrollTop = logEl.scrollHeight;
          container.querySelector('#pv-log-info').textContent = `(${data.lines.length} 行, offset=${this._logOffset})`;
        }
      }
    } catch (e) {
      console.warn('historical log load failed', e);
    }
  },

  _openSSE(jobId, container, setStage, setStatusPill) {
    if (this._es) { try { this._es.close(); } catch (e) {} this._es = null; }

    const STAGES = ['scan', 'preprocess', 'assemble', 'diagnose', 'umap', 'cluster', 'name', 'output'];
    const STAGE_LABELS = { scan: '扫描图片', preprocess: '预处理', assemble: '特征装配', diagnose: '特征诊断', umap: 'UMAP 降维', cluster: '聚类', name: '命名', output: '写产物' };

    const logEl = container.querySelector('#pv-log');
    const barEl = container.querySelector('#pv-bar');
    const statusEl = container.querySelector('#pv-status');

    const appendLog = (line) => {
      logEl.textContent += line + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    };

    try {
      const url = apiBase() + '/jobs/' + encodeURIComponent(jobId) + '/events?since_offset=' + this._logOffset;
      this._es = new EventSource(url);

      this._es.addEventListener('progress', (ev) => {
        try {
          const data = JSON.parse(ev.data);
          const stageIdx = STAGES.indexOf(data.stage);
          STAGES.forEach((s, i) => {
            if (i < stageIdx) setStage(s, 'done');
            else if (i === stageIdx) setStage(s, 'active');
            else setStage(s, 'pending');
          });
          if (typeof data.progress === 'number') {
            barEl.style.width = (data.progress * 100) + '%';
          }
          if (data.log) {
            statusEl.textContent = `${STAGE_LABELS[data.stage] || data.stage}: ${data.log}`;
            appendLog(`[${STAGE_LABELS[data.stage] || data.stage}] ${data.log}`);
          } else if (data.stage) {
            statusEl.textContent = `${STAGE_LABELS[data.stage] || data.stage} (${Math.round((data.progress || 0) * 100)}%)`;
          }
        } catch (e) { console.warn('SSE parse:', e); }
      });

      this._es.addEventListener('log', (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.message) appendLog(data.message);
        } catch (e) {}
      });

      this._es.addEventListener('complete', (ev) => {
        try {
          const data = JSON.parse(ev.data);
          STAGES.forEach(s => setStage(s, 'done'));
          barEl.style.width = '100%';
          statusEl.textContent = '✓ 完成! 跳转到画板...';
          setStatusPill('✓ 完成', 'var(--success)');
          Toast.success('分析完成');
          setTimeout(() => {
            JobStore.setActive(data.job_id || jobId);
            App.switchView('organize', { jobId: data.job_id || jobId });
          }, 1500);
        } catch (e) {}
      });

      this._es.addEventListener('done', (ev) => {
        try { this._es.close(); this._es = null; } catch (e) {}
      });

      this._es.addEventListener('failed', (ev) => {
        try {
          const data = JSON.parse(ev.data);
          statusEl.textContent = '✗ 失败: ' + (data.message || '');
          statusEl.style.color = 'var(--error)';
          setStatusPill('✗ 失败', 'var(--error)');
          container.querySelector('#pv-actions').style.display = 'flex';
          if (data.traceback) appendLog(data.traceback);
        } catch (e) {}
      });

      this._es.addEventListener('error', (ev) => {
        if (this._es && this._es.readyState === EventSource.CLOSED) {
          statusEl.textContent = '⚠ 连接断开 (SSE)';
        }
      });
    } catch (e) {
      statusEl.textContent = '无法订阅: ' + e.message;
    }
  }
};

window.ProgressView = ProgressView;
