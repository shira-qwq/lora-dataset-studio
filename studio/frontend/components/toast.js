/* Toast — 通用 toast 通知 */

const Toast = {
  show(msg, type = 'info', duration = 2500) {
    const colors = {
      info: 'var(--accent)',
      success: 'var(--success)',
      warning: 'var(--warning)',
      error: 'var(--error)'
    };
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.cssText = `
      position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
      z-index: 99999; background: var(--bg-elev); color: var(--text);
      border: 1px solid ${colors[type] || colors.info};
      border-radius: 8px; padding: 10px 20px; font-size: 13px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      max-width: 80vw; word-break: break-word;
    `;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity 0.3s';
      setTimeout(() => t.remove(), 300);
    }, duration);
  },

  info(msg, duration) { this.show(msg, 'info', duration); },
  success(msg, duration) { this.show(msg, 'success', duration); },
  error(msg, duration) { this.show(msg, 'error', duration || 4000); },
  warning(msg, duration) { this.show(msg, 'warning', duration); }
};

window.Toast = Toast;
