/* SimilarityView — 相似图工具占位页 (v4.5-ui)
 *
 * 未来功能:
 * - imagehash 近重复检测
 * - DINOv2 视觉相似图
 *
 * 本轮不实现算法.
 */

const SimilarityView = {
  render(container, params = {}) {
    const jobId = params.jobId || (window.JobStore && JobStore.activeId);

    container.style.cssText = 'height:100vh;overflow:hidden;background:var(--bg);display:flex;flex-direction:column';

    const topbar = document.createElement('div');
    topbar.style.cssText = 'height:48px;padding:0 12px;background:var(--bg-elev);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0';
    topbar.innerHTML = `
      <button class="sv-back" style="padding:4px 8px;background:transparent;border:none;color:var(--text-soft);cursor:pointer;font-size:14px">←</button>
      <span style="font-size:13px;font-weight:600;color:var(--text)">🔍 相似图</span>
      <span style="font-size:11px;color:var(--text-muted)">${jobId ? escape(jobId) : ''}</span>
    `;
    container.appendChild(topbar);

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center';
    body.innerHTML = `
      <div style="text-align:center;padding:40px;max-width:480px">
        <div style="font-size:48px;margin-bottom:16px">🔍</div>
        <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px">相似图工具 (开发中)</div>
        <div style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:16px">
          未来将支持:
        </div>
        <div style="text-align:left;font-size:12px;color:var(--text-soft);line-height:1.8;background:var(--bg-elev);padding:16px;border-radius:8px;border:1px solid var(--border)">
          <div>• ImageHash 近重复检测</div>
          <div>• DINOv2 视觉相似图</div>
          <div>• 按图片查找同簇/相似图片</div>
          <div style="margin-top:8px;color:var(--text-muted);font-size:11px">本轮不实现算法, 仅占位.</div>
        </div>
      </div>
    `;
    container.appendChild(body);

    topbar.querySelector('.sv-back').onclick = () => App.switchView('home');
  }
};

window.SimilarityView = SimilarityView;
