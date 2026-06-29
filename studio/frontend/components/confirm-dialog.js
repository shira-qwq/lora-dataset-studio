/* Confirm — 通用确认弹窗 (Promise-based) */

const Confirm = {
  ask(title, message, opts = {}) {
    return new Promise(resolve => {
      const yesText = opts.yesText || '确定';
      const noText = opts.noText || '取消';
      const yesStyle = opts.danger
        ? 'background:var(--error);color:#fff'
        : 'background:var(--accent);color:var(--on-accent)';

      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.5);
        z-index: 99999; display: flex; align-items: center; justify-content: center;
      `;
      overlay.innerHTML = `
        <div style="
          background: var(--bg-elev);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 20px;
          min-width: 320px; max-width: 480px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        ">
          <h3 style="margin:0 0 10px;color:var(--text);font-size:15px;font-weight:600">${escape(title)}</h3>
          <p style="color:var(--text-soft);margin:0 0 20px;font-size:13px;line-height:1.5">${escape(message)}</p>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="cf-no" style="
              padding: 6px 16px; background: var(--bg-elev); color: var(--text);
              border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 13px;
            ">${escape(noText)}</button>
            <button class="cf-yes" style="
              padding: 6px 16px; ${yesStyle};
              border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;
            ">${escape(yesText)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const close = (val) => { overlay.remove(); resolve(val); };
      overlay.querySelector('.cf-yes').onclick = () => close(true);
      overlay.querySelector('.cf-no').onclick = () => close(false);
      overlay.onclick = (e) => { if (e.target === overlay) close(false); };
      // ESC to cancel
      const escHandler = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); close(false); }
      };
      document.addEventListener('keydown', escHandler);
      // Focus the cancel button by default
      overlay.querySelector('.cf-no').focus();
    });
  }
};

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

window.Confirm = Confirm;
window.escape = escape;
