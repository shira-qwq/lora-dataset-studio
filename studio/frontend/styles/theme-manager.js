/* ThemeManager — 主题切换 + 3 色自定义 + 持久化 */

const ThemeManager = {
  STORAGE_KEY: 'cluster_organizer_theme',

  // 9 token (3 主 + 3 派生背景 + 3 状态 + 3 簇色 = 9 主用)
  TOKENS: [
    'bg', 'text', 'accent',
    'bg-elev', 'bg-deep', 'border',
    'accent-soft', 'accent-hover', 'on-accent',
    'success', 'warning', 'error',
    'cluster-1', 'cluster-2', 'cluster-3'
  ],

  apply({ preset, custom } = {}) {
    const p = preset || 'dark';
    document.documentElement.setAttribute('data-theme', p);
    if (custom) {
      Object.entries(custom).forEach(([token, value]) => {
        if (value) document.documentElement.style.setProperty('--' + token, value);
      });
    }
  },

  reset(preset) {
    this.TOKENS.forEach(t => document.documentElement.style.removeProperty('--' + t));
    this.apply({ preset: preset || 'dark' });
  },

  save(state) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
  },

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : { preset: 'dark', custom: null };
    } catch (e) {
      return { preset: 'dark', custom: null };
    }
  },

  init() {
    this.apply(this.load());
  }
};

window.ThemeManager = ThemeManager;
