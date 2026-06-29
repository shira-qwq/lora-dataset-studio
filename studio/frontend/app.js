/* App — 入口 + View 切换 + 主题初始化 + 未保存检查
 *
 * v4.5-ui: 新增 analysis, similarity, export-review view
 *
 * ⚠️ 维护状态: 兼容维护
 * 此文件为原始 vanilla JS 前端入口，功能完整但不再积极开发。
 * 新功能/修复请优先在 React V2 (studio/frontend_react/) 中实现。
 */

function apiBase() {
  return 'http://127.0.0.1:8003/api/v1';
}
window.apiBase = apiBase;

const App = {
  currentView: 'home',
  currentParams: {},

  async switchView(view, params = {}) {
    // Before leaving a view with unsaved changes, ask the user
    if (this.currentView === 'organize' && view !== 'organize') {
      if (window.OrganizerWorkspace && OrganizerWorkspace.hasUnsavedChanges && OrganizerWorkspace.hasUnsavedChanges()) {
        const choice = await this._promptUnsavedChanges();
        if (choice === 'cancel') return;
        if (choice === 'save') {
          await OrganizerWorkspace._save();
        }
        // 'discard' just continue
      }
    }
    this.currentView = view;
    this.currentParams = params;
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '<div style="padding:24px;color:var(--text-muted);text-align:center">Loading...</div>';
    try {
      switch (view) {
        case 'home': HomeView.render(app); break;
        case 'new-analysis': NewAnalysisDialog.render(app); break;
        case 'progress': ProgressView.render(app, params); break;
        case 'organize':
          if (typeof OrganizerWorkspace !== 'undefined') OrganizerWorkspace.render(app, params);
          else app.innerHTML = '<div style="padding:24px;color:var(--text-muted)">Organizer not loaded</div>';
          break;
        case 'analysis':
          if (typeof AnalysisView !== 'undefined') AnalysisView.render(app, params);
          else app.innerHTML = '<div style="padding:24px;color:var(--text-muted)">AnalysisView not loaded</div>';
          break;
        case 'similarity':
          if (typeof SimilarityView !== 'undefined') SimilarityView.render(app, params);
          else app.innerHTML = '<div style="padding:24px;color:var(--text-muted)">SimilarityView not loaded</div>';
          break;
        case 'export-review':
          if (typeof ExportReviewView !== 'undefined') ExportReviewView.render(app, params);
          else app.innerHTML = '<div style="padding:24px;color:var(--text-muted)">ExportReviewView not loaded</div>';
          break;
        default:
          app.innerHTML = '<div style="padding:24px;color:var(--text-muted)">Unknown view: ' + view + '</div>';
      }
    } catch (e) {
      console.error('switchView error:', view, e);
      app.innerHTML = `<div style="padding:24px;color:var(--error)">Error: ${e.message}</div>`;
    }
  },

  _promptUnsavedChanges() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center';
      overlay.innerHTML = `
        <div style="background:var(--bg-elev);border:1px solid var(--border);border-radius:8px;padding:24px;min-width:360px;max-width:480px">
          <h3 style="margin:0 0 12px;color:var(--text);font-size:15px">⚠ 未保存的修改</h3>
          <p style="color:var(--text-soft);margin:0 0 20px;font-size:13px;line-height:1.5">当前工作区有未保存的修改。你想：</p>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button data-c="cancel" style="padding:6px 14px;background:var(--bg-elev);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:13px">留在页面</button>
            <button data-c="discard" style="padding:6px 14px;background:transparent;color:var(--error);border:1px solid var(--error);border-radius:4px;cursor:pointer;font-size:13px">丢弃修改</button>
            <button data-c="save" style="padding:6px 14px;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500">保存并继续</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => { const c = btn.dataset.c; overlay.remove(); resolve(c); };
      });
    });
  },

  getUrlJobId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('job');
  },

  async _jobExists(jobId) {
    if (!jobId) return false;
    try {
      const resp = await fetch(apiBase() + '/jobs/' + encodeURIComponent(jobId));
      return resp.ok;
    } catch (e) {
      console.warn('job validation failed:', jobId, e);
      return false;
    }
  },

  async restoreInitialView() {
    const urlJob = App.getUrlJobId();
    const preferredJob = urlJob || JobStore.activeId;

    if (!preferredJob) {
      App.switchView('home');
      return;
    }

    const exists = await this._jobExists(preferredJob);
    if (exists) {
      if (urlJob) JobStore.setActive(urlJob);
      App.switchView('organize', { jobId: preferredJob });
      return;
    }

    JobStore.setActive('');
    if (urlJob) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('job');
      window.history.replaceState({}, '', cleanUrl.toString());
    }
    if (window.Toast?.error) {
      Toast.error('上次打开的项目已不可用，已返回项目列表');
    }
    App.switchView('home');
  }
};

window.App = App;
window.switchView = (view, params) => App.switchView(view, params);

window.addEventListener('DOMContentLoaded', async () => {
  ThemeManager.init();
  await App.restoreInitialView();
});
