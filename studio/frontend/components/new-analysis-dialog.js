/* NewAnalysisDialog — 新建分析弹窗 (v4 schema-driven)
 *
 * - 拖放文件夹支持
 * - 自动补全 output 路径
 * - 表单完全从 /jobs/schema 动态渲染
 */

const NewAnalysisDialog = {
  _schema: null,  // Cached schema

  async render(container) {
    container.style.cssText = 'height:100vh;overflow-y:auto;background:var(--bg)';

    // Load schema first
    if (!this._schema) {
      try {
        const r = await fetch(apiBase() + '/jobs/schema');
        this._schema = await r.json();
      } catch (e) {
        Toast.error('无法加载配置 schema: ' + e.message);
        this._schema = { feature_groups: {}, params: {}, presets: ['full'] };
      }
    }
    const schema = this._schema;

    // 渲染 feature group checkboxes
    const featureGroupHtml = Object.entries(schema.feature_groups).map(([name, g]) => `
      <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--bg);border-radius:3px;cursor:pointer;font-size:12px">
        <input type="checkbox" class="fg-enabled" data-name="${name}" ${g.enabled ? 'checked' : ''}>
        <span style="flex:1">${g.label || name}</span>
        <span style="color:var(--text-muted);font-size:10px">${g.dims}维</span>
      </label>
    `).join('');

    // 渲染 param inputs
    const paramHtml = Object.entries(schema.params).map(([name, p]) => {
      const step = p.step || (p.type === 'int' ? 1 : 0.1);
      return `
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px">
          <span style="width:120px;color:var(--text-soft)">${p.label || name}</span>
          <input type="number" class="cfg-param" data-name="${name}"
            min="${p.min}" max="${p.max}" step="${step}" value="${p.default}"
            style="flex:1;padding:3px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:3px;font-family:monospace">
          ${p.description ? `<small style="color:var(--text-muted);font-size:10px;width:200px">${p.description}</small>` : ''}
        </label>
      `;
    }).join('');

    container.innerHTML = `
      <div style="padding:16px;background:var(--bg-elev);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px">
        <button id="nad-back" style="padding:5px 10px;background:transparent;border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer">← 返回</button>
        <div style="font-size:15px;font-weight:600;color:var(--text)">新建分析</div>
      </div>

      <div id="nad-dropzone" data-test="dropzone" style="
        max-width:700px;margin:24px auto;padding:32px 24px;
        background:var(--bg-elev);border:2px dashed var(--border);border-radius:12px;
        text-align:center;cursor:pointer;transition:all 0.2s;
      ">
        <div style="font-size:36px;color:var(--accent);margin-bottom:8px">📁</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px">把文件夹拖到这里</div>
        <div style="font-size:12px;color:var(--text-muted)">或点击下方输入路径</div>
      </div>

      <div style="max-width:700px;margin:0 auto 40px;padding:0 24px">
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">输入文件夹路径</label>
          <div style="display:flex;gap:8px">
            <input id="nad-input" type="text" placeholder="D:\\Pictures\\test" data-test="input-folder" style="
              flex:1;padding:8px;background:var(--bg);border:1px solid var(--border);
              color:var(--text);border-radius:3px;font-size:13px;outline:none;font-family:monospace;
            ">
            <button id="nad-browse" style="padding:8px 12px;background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer;font-size:12px">浏览...</button>
          </div>
          <div id="nad-scan" style="margin-top:6px;font-size:11px;color:var(--text-muted);min-height:16px"></div>
        </div>

        <div style="margin-bottom:16px">
          <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">
            输出目录
            <span style="color:var(--text-muted);font-size:10px">(自动补全: 输入 + "_output")</span>
            <span id="nad-output-lock" style="color:var(--accent);font-size:10px;display:none">🔒 已手动修改</span>
          </label>
          <input id="nad-output" type="text" placeholder="D:\\Pictures\\test_output" data-test="input-output" style="
            width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);
            color:var(--text);border-radius:3px;font-size:13px;outline:none;font-family:monospace;
          ">
        </div>

        <div style="margin-bottom:16px">
          <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">预设</label>
          <select id="nad-preset" data-test="select-preset" style="
            width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);
            color:var(--text);border-radius:3px;font-size:13px;
          ">
            ${schema.presets.map(p => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>

        <details style="margin-bottom:16px" open>
          <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);user-select:none;margin-bottom:8px">
            ▾ 特征组 (${Object.keys(schema.feature_groups).length} 个, 动态从 schema 加载)
          </summary>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px;background:var(--bg);border-radius:4px">
            ${featureGroupHtml}
          </div>
        </details>

        <details style="margin-bottom:16px">
          <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);user-select:none;margin-bottom:8px">
            ▾ 参数 (${Object.keys(schema.params).length} 个, 动态从 schema 加载)
          </summary>
          <div style="padding:8px;background:var(--bg);border-radius:4px">
            ${paramHtml}
          </div>
        </details>

        <div style="text-align:right;margin-top:20px">
          <button id="nad-start" data-test="btn-start" style="
            padding:8px 20px;background:var(--accent);color:var(--on-accent);
            border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500
          ">开始分析</button>
        </div>
        <div id="nad-msg" style="margin-top:12px;font-size:12px;line-height:1.5"></div>
      </div>
    `;

    container.querySelector('#nad-back').onclick = () => App.switchView('home');

    const input = container.querySelector('#nad-input');
    const output = container.querySelector('#nad-output');
    const outputLock = container.querySelector('#nad-output-lock');
    const scanDiv = container.querySelector('#nad-scan');
    const dropzone = container.querySelector('#nad-dropzone');

    // 拖放支持
    const setDragHighlight = (on) => {
      dropzone.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
      dropzone.style.background = on ? 'var(--bg-elev)' : 'var(--bg-elev)';
    };
    const extractFolderPath = (dataTransfer) => {
      const items = dataTransfer.items;
      if (items && items.length) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
            if (entry && entry.fullPath) return entry.fullPath.replace(/^[\\\/]/, '');
            const f = item.getAsFile && item.getAsFile();
            if (f && f.path) return f.path.replace(/[\\\/][^\\\/]*$/, '');
          }
        }
      }
      if (dataTransfer.files && dataTransfer.files.length) {
        const f = dataTransfer.files[0];
        if (f.path) return f.path.replace(/[\\\/][^\\\/]*$/, '');
      }
      return null;
    };
    const handleDrop = (e) => {
      e.preventDefault(); e.stopPropagation();
      setDragHighlight(false);
      const path = extractFolderPath(e.dataTransfer);
      if (path) { input.value = path; input.oninput(); Toast.success('已填入路径: ' + path); }
      else { Toast.warning('无法获取文件夹路径，请直接输入'); }
    };
    ['dragenter', 'dragover'].forEach(ev => {
      document.body.addEventListener(ev, (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
          e.preventDefault(); setDragHighlight(true);
        }
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      document.body.addEventListener(ev, () => setDragHighlight(false));
    });
    document.body.addEventListener('drop', handleDrop);
    dropzone.onclick = () => input.focus();

    // 自动补全 output
    const autofillOutput = () => {
      const p = input.value.trim().replace(/[\\\/]+$/, '');
      if (!p) return;
      const current = output.value.trim();
      const expectedAuto = p + '_output';
      if (!current || current === output.dataset.lastAutofill || output.dataset.userEdited !== 'true') {
        output.value = expectedAuto;
        output.dataset.lastAutofill = expectedAuto;
        output.dataset.userEdited = 'false';
        outputLock.style.display = 'none';
      }
    };
    input.oninput = () => {
      autofillOutput();
      clearTimeout(this._scanTimer);
      this._scanTimer = setTimeout(() => this._scan(input.value.trim(), scanDiv), 500);
    };
    output.oninput = () => {
      const currentAuto = (input.value.trim().replace(/[\\\/]+$/, '') || '') + '_output';
      if (output.value.trim() !== currentAuto) {
        output.dataset.userEdited = 'true';
        outputLock.style.display = '';
      } else {
        output.dataset.userEdited = 'false';
        outputLock.style.display = 'none';
      }
    };

    container.querySelector('#nad-browse').onclick = () => {
      const p = prompt('输入文件夹绝对路径:', input.value || 'C:\\');
      if (p) { input.value = p; input.oninput(); }
    };

    // 收集当前所有可调参数
    const collectConfig = () => {
      const featureGroups = {};
      container.querySelectorAll('.fg-enabled').forEach(cb => {
        const name = cb.dataset.name;
        const def = schema.feature_groups[name] || {};
        featureGroups[name] = { ...def, enabled: cb.checked };
      });
      const params = {};
      container.querySelectorAll('.cfg-param').forEach(inp => {
        const name = inp.dataset.name;
        const v = parseFloat(inp.value);
        if (!isNaN(v)) params[name] = v;
      });
      return { feature_groups: featureGroups, ...params };
    };

    container.querySelector('#nad-start').onclick = async () => {
      const inDir = input.value.trim();
      const outDir = output.value.trim();
      const preset = container.querySelector('#nad-preset').value;
      if (!inDir) { this._showMsg(container, '请填写输入文件夹路径', 'error'); return; }
      if (!outDir) { this._showMsg(container, '请填写输出目录', 'error'); return; }

      this._showMsg(container, '正在启动分析...', 'info');
      const btn = container.querySelector('#nad-start');
      btn.disabled = true; btn.textContent = '启动中...';

      try {
        const config = collectConfig();
        config.preset = preset;
        const resp = await fetch(apiBase() + '/jobs', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            input_folders: [inDir],
            output_folder: outDir,
            config: config
          })
        });
        const data = await resp.json();
        if (resp.ok && data.job_id) {
          this._showMsg(container, '✓ 启动成功! 跳转到进度页...', 'success');
          setTimeout(() => App.switchView('progress', { jobId: data.job_id }), 600);
        } else {
          const errMsg = data.detail || data.message || JSON.stringify(data);
          this._showMsg(container, '✗ 启动失败: ' + errMsg, 'error');
          btn.disabled = false; btn.textContent = '开始分析';
        }
      } catch (e) {
        this._showMsg(container, '✗ 请求失败: ' + e.message, 'error');
        btn.disabled = false; btn.textContent = '开始分析';
      }
    };
  },

  _showMsg(container, msg, type) {
    const el = container.querySelector('#nad-msg');
    if (!el) return;
    el.textContent = msg;
    el.style.color = type === 'error' ? 'var(--error)' :
                     type === 'success' ? 'var(--success)' : 'var(--text-muted)';
  },

  async _scan(path, target) {
    if (!path) { target.textContent = ''; return; }
    target.textContent = '扫描中...';
    target.style.color = 'var(--text-muted)';
    try {
      const resp = await fetch(apiBase() + '/jobs/scan-folder', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ path })
      });
      const data = await resp.json();
      if (data.ok) {
        target.textContent = '✓ 找到 ' + data.image_count + ' 张图片';
        target.style.color = 'var(--success)';
      } else {
        target.textContent = '✗ ' + (data.message || '无法访问');
        target.style.color = 'var(--error)';
      }
    } catch (e) {
      target.textContent = '✗ 无法连接: ' + e.message;
      target.style.color = 'var(--error)';
    }
  }
};

window.NewAnalysisDialog = NewAnalysisDialog;
