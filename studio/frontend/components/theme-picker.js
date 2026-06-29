/* ThemePicker — 主题切换 (3 色: 背景/按钮/文字) */

const ThemePicker = {
  render(container) {
    const state = ThemeManager.load();
    const presets = [
      { id: 'dark',      name: 'Dark',      desc: '深色' },
      { id: 'light',     name: 'Light',     desc: '浅色' },
      { id: 'solarized', name: 'Solarized', desc: '米色' }
    ];

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:inline-block';
    wrap.innerHTML = `
      <button class="tp-trigger" data-test="theme-picker" style="
        padding: 4px 10px; background: var(--bg-elev); color: var(--text);
        border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px;
      ">主题 ▾</button>
      <div class="tp-menu" style="
        position:absolute;right:0;top:100%;margin-top:4px;
        background:var(--bg-elev);border:1px solid var(--border);border-radius:6px;
        padding:6px;min-width:240px;display:none;z-index:1000;
        box-shadow:0 4px 16px rgba(0,0,0,0.3);
      ">
        <div style="padding:4px 8px;color:var(--text-muted);font-size:11px;font-weight:600">预设主题</div>
        ${presets.map(p => `
          <div class="tp-preset" data-preset="${p.id}" data-test="theme-${p.id}" style="
            display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;
            border-radius:4px;font-size:13px;color:var(--text);
          ">
            <span style="display:inline-flex;gap:2px">
              <span style="width:14px;height:14px;border-radius:50%;background:var(--bg);border:1px solid var(--border)"></span>
              <span style="width:14px;height:14px;border-radius:50%;background:var(--accent)"></span>
              <span style="width:14px;height:14px;border-radius:50%;background:var(--text)"></span>
            </span>
            <span style="flex:1">${p.name}</span>
            <span style="font-size:10px;color:var(--text-muted)">${p.desc}</span>
          </div>
        `).join('')}
        <div style="margin:6px 0;border-top:1px solid var(--border)"></div>
        <div style="padding:4px 8px;color:var(--text-muted);font-size:11px;font-weight:600">自定义 (3 色)</div>
        <label style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:12px;color:var(--text-soft)">
          <span style="width:50px">背景</span>
          <input type="color" class="tp-bg" value="${state.custom && state.custom.bg || '#131313'}" style="width:28px;height:22px;border:1px solid var(--border);background:transparent;cursor:pointer">
        </label>
        <label style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:12px;color:var(--text-soft)">
          <span style="width:50px">按钮</span>
          <input type="color" class="tp-accent" value="${state.custom && state.custom.accent || '#46f1c5'}" style="width:28px;height:22px;border:1px solid var(--border);background:transparent;cursor:pointer">
        </label>
        <label style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:12px;color:var(--text-soft)">
          <span style="width:50px">文字</span>
          <input type="color" class="tp-text" value="${state.custom && state.custom.text || '#e5e2e1'}" style="width:28px;height:22px;border:1px solid var(--border);background:transparent;cursor:pointer">
        </label>
        <div style="padding:4px 8px;text-align:right">
          <button class="tp-reset" data-test="theme-reset" style="
            padding:3px 10px;background:transparent;color:var(--text-soft);
            border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px
          ">重置为预设</button>
        </div>
      </div>
    `;
    container.appendChild(wrap);

    const trigger = wrap.querySelector('.tp-trigger');
    const menu = wrap.querySelector('.tp-menu');
    const accentInput = wrap.querySelector('.tp-accent');
    const bgInput = wrap.querySelector('.tp-bg');
    const textInput = wrap.querySelector('.tp-text');

    trigger.onclick = (e) => {
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    };
    document.addEventListener('click', () => { menu.style.display = 'none'; });

    wrap.querySelectorAll('.tp-preset').forEach(el => {
      el.onmouseover = () => el.style.background = 'var(--bg-deep)';
      el.onmouseout = () => el.style.background = 'transparent';
      el.onclick = (e) => {
        e.stopPropagation();
        const preset = el.dataset.preset;
        ThemeManager.reset(preset);
        ThemeManager.save({ preset, custom: null });
        _refreshInputs();
        menu.style.display = 'none';
        Toast.success('已切换到 ' + preset);
      };
    });

    function _refreshInputs() {
      const cs = getComputedStyle(document.documentElement);
      accentInput.value = cs.getPropertyValue('--accent').trim() || '#46f1c5';
      bgInput.value = cs.getPropertyValue('--bg').trim() || '#131313';
      textInput.value = cs.getPropertyValue('--text').trim() || '#e5e2e1';
    }

    let saveTimer = null;
    const applyCustom = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const s = ThemeManager.load();
        const custom = {
          bg: bgInput.value,
          accent: accentInput.value,
          text: textInput.value
        };
        ThemeManager.apply({ preset: s.preset, custom });
        ThemeManager.save({ preset: s.preset, custom });
      }, 300);
    };
    bgInput.onchange = applyCustom;
    accentInput.onchange = applyCustom;
    textInput.onchange = applyCustom;

    wrap.querySelector('.tp-reset').onclick = (e) => {
      e.stopPropagation();
      const s = ThemeManager.load();
      ThemeManager.reset(s.preset);
      ThemeManager.save({ preset: s.preset, custom: null });
      _refreshInputs();
      Toast.info('已重置为预设 ' + s.preset);
    };

    return wrap;
  }
};

window.ThemePicker = ThemePicker;
