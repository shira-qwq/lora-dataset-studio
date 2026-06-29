/* AnalysisPanel — v4.5-ui 分析面板 (Drawer)
 *
 * 功能:
 * 1. Analysis cache status (histogram / quality-edge)
 * 2. Sort mode 选择:
 *    - In-cluster sort: 簇内排序 (不改变簇归属)
 *    - Cluster sort: 簇卡片排序
 *    - Global analysis view: 全局图片排序
 * 3. Sort field / order / label filter
 * 4. Missing cache 提示 + 生成按钮
 *
 * 依赖: Confirm (confirm-dialog.js), Toast (toast.js), apiBase()
 * 如果 Confirm/Toast 不存在, 自动降级
 *
 * 不改变默认聚类, 不改变 cluster assignment, 不影响保存/导出
 */

(function () {
  'use strict';

  // ================================================================
  // 常量
  // ================================================================

  var API_PREFIX = '/api/v1/jobs';

  // 簇内排序字段 (in-cluster sort, 只排序簇内图片)
  var IN_CLUSTER_FIELDS = {
    histogram: {
      histogram_outlier_score: '异常分数 ↑',
      brightness_dark_ratio: '暗部比例 ↑',
      brightness_bright_ratio: '亮部比例 ↑',
      saturation_low_ratio: '低饱和度比例 ↑',
      saturation_high_ratio: '高饱和度比例 ↑',
      hue_warm_ratio: '暖色比例 ↑',
      hue_cool_ratio: '冷色比例 ↑',
    },
    quality_edge: {
      sharpness_score: '清晰度 ↑',
      blur_laplacian_var: '模糊度 ↑',
      edge_density: '边缘密度 ↑',
      local_contrast_p95: '局部对比度 ↑',
      lineart_score_v2: '线稿分数 ↑',
      high_contrast_score_v2: '高对比分数 ↑',
    },
  };

  // 簇排序字段 (cluster sort, 排序 cluster card)
  var CLUSTER_FIELDS = {
    cluster_size: '簇大小 ↓',
    cluster_id: '簇 ID',
    silhouette: 'Silhouette ↓',
    noise_rate: 'Noise 率 ↓',
  };

  // Label filter 选项
  var LABEL_OPTIONS = [
    { value: '', label: '所有标签' },
    { value: 'low_key', label: '低 key' },
    { value: 'high_key', label: '高 key' },
    { value: 'high_contrast', label: '高对比' },
    { value: 'muted', label: '柔和' },
    { value: 'vivid', label: '鲜艳' },
    { value: 'warm', label: '暖色' },
    { value: 'cool', label: '冷色' },
    { value: 'flat_light', label: '平光' },
    { value: 'mixed_color', label: '混合色' },
  ];

  // ================================================================
  // 内部状态
  // ================================================================

  var _drawerEl = null;
  var _jobId = null;
  var _callbacks = {};

  // 分析缓存状态
  var _histogramReady = false;
  var _qualityEdgeReady = false;
  var _availableSortFields = [];
  var _availableFilterLabels = [];

  // 当前选择
  var _sortMode = 'in_cluster'; // 'in_cluster' | 'cluster' | 'global'
  var _sortField = '';
  var _sortOrder = 'desc';
  var _filterLabel = '';

  // ================================================================
  // 工具函数
  // ================================================================

  function _apiUrl(path) {
    var base = typeof apiBase === 'function' ? apiBase() : 'http://127.0.0.1:8003/api/v1';
    return base + path;
  }

  function _escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function _toast(msg, type) {
    if (typeof Toast !== 'undefined' && Toast[type]) {
      Toast[type](msg);
    } else if (type === 'error') {
      console.error('[AnalysisPanel]', msg);
    } else {
      console.log('[AnalysisPanel]', msg);
    }
  }

  // ================================================================
  // API
  // ================================================================

  async function _fetchAnalysisStatus(jobId) {
    var resp = await fetch(
      _apiUrl(API_PREFIX + '/' + encodeURIComponent(jobId) + '/analysis/status')
    );
    if (!resp.ok) {
      return {
        ok: false,
        histogram_ready: false,
        quality_edge_ready: false,
        available_sort_fields: [],
        available_filter_labels: [],
      };
    }
    return resp.json();
  }

  // ================================================================
  // Drawer 渲染
  // ================================================================

  function _renderDrawer() {
    // Remove existing drawer
    var existing = document.getElementById('ap-drawer');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'ap-drawer';
    overlay.style.cssText =
      'position:fixed;top:0;right:0;bottom:0;width:320px;z-index:99997;' +
      'display:flex;flex-direction:column;' +
      'background:var(--bg-elev);border-left:1px solid var(--border);' +
      'box-shadow:-4px 0 24px rgba(0,0,0,0.3);' +
      'transform:translateX(0);transition:transform 0.25s ease';

    overlay.innerHTML =
      // Header
      '<div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">' +
      '<span style="font-size:14px;font-weight:600;color:var(--text)">🔬 分析面板</span>' +
      '<span style="flex:1"></span>' +
      '<button class="ap-close" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:2px 6px">&times;</button>' +
      '</div>' +
      // Body (scrollable)
      '<div style="flex:1;overflow-y:auto;padding:12px 16px">' +
      // 1. Cache Status
      '<div style="margin-bottom:16px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">分析缓存</div>' +
      '<div class="ap-cache-status"></div>' +
      '</div>' +
      // 2. Sort Mode
      '<div style="margin-bottom:16px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">排序模式</div>' +
      '<div class="ap-sort-modes"></div>' +
      '</div>' +
      // 3. Sort Controls
      '<div style="margin-bottom:16px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">排序设置</div>' +
      '<div class="ap-sort-controls"></div>' +
      '</div>' +
      // 4. Info
      '<div class="ap-info" style="font-size:11px;color:var(--text-muted);line-height:1.5;padding-top:8px;border-top:1px solid var(--border)"></div>' +
      '</div>';

    _drawerEl = overlay;
    document.body.appendChild(overlay);

    // Close handler
    overlay.querySelector('.ap-close').onclick = _closeDrawer;

    // ESC to close
    document.addEventListener('keydown', _onEscKey);

    // Render sections
    _renderCacheStatus();
    _renderSortModes();
    _renderSortControls();
    _renderInfo();
  }

  function _onEscKey(e) {
    if (e.key === 'Escape' && _drawerEl) {
      _closeDrawer();
    }
  }

  function _closeDrawer() {
    if (_drawerEl) {
      // Exit global view when closing drawer? No, keep view as is.
      _drawerEl.remove();
      _drawerEl = null;
    }
    document.removeEventListener('keydown', _onEscKey);
  }

  // ================================================================
  // Cache Status
  // ================================================================

  function _renderCacheStatus() {
    var el = _drawerEl && _drawerEl.querySelector('.ap-cache-status');
    if (!el) return;

    var histStatus = _histogramReady
      ? '<span style="color:var(--success)">✅ 已就绪</span>'
      : '<span style="color:var(--text-muted)">❌ 未生成</span>';

    var qeStatus = _qualityEdgeReady
      ? '<span style="color:var(--success)">✅ 已就绪</span>'
      : '<span style="color:var(--text-muted)">❌ 未生成</span>';

    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px">' +
      '<span style="color:var(--text)">直方图分析</span>' +
      histStatus +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px">' +
      '<span style="color:var(--text)">质量/边缘分析</span>' +
      qeStatus +
      '</div>';

    // Build buttons for missing caches
    if (!_histogramReady || !_qualityEdgeReady) {
      var btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'margin-top:8px;display:flex;flex-direction:column;gap:6px';

      if (!_histogramReady) {
        var histBtn = document.createElement('button');
        histBtn.textContent = '生成直方图缓存';
        histBtn.style.cssText =
          'padding:5px 10px;background:var(--bg);border:1px solid var(--border);' +
          'color:var(--text);border-radius:4px;cursor:pointer;font-size:11px';
        histBtn.onclick = function () {
          _toast('请运行: tools/build_histogram_channel.py --job-output ' + _jobId, 'info');
        };
        btnContainer.appendChild(histBtn);
      }

      if (!_qualityEdgeReady) {
        var qeBtn = document.createElement('button');
        qeBtn.textContent = '生成质量/边缘缓存';
        qeBtn.style.cssText =
          'padding:5px 10px;background:var(--bg);border:1px solid var(--border);' +
          'color:var(--text);border-radius:4px;cursor:pointer;font-size:11px';
        qeBtn.onclick = function () {
          _toast('请运行: tools/build_quality_edge_channel.py --job-output ' + _jobId, 'info');
        };
        btnContainer.appendChild(qeBtn);
      }

      el.appendChild(btnContainer);
    }
  }

  // ================================================================
  // Sort Modes
  // ================================================================

  function _renderSortModes() {
    var el = _drawerEl && _drawerEl.querySelector('.ap-sort-modes');
    if (!el) return;

    var modes = [
      { value: 'in_cluster', label: '簇内排序', desc: '只排序每个簇内部的图片顺序' },
      { value: 'cluster', label: '簇排序', desc: '对簇卡片整体排序' },
      { value: 'global', label: '全局分析视图', desc: '全局图片排序/筛选, 不显示簇卡片' },
    ];

    el.innerHTML = modes
      .map(function (m) {
        var checked = _sortMode === m.value ? 'checked' : '';
        return (
          '<label style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;cursor:pointer">' +
          '<input type="radio" name="ap-sort-mode" value="' +
          _escape(m.value) +
          '" ' +
          checked +
          ' style="margin-top:2px;accent-color:var(--accent)">' +
          '<div>' +
          '<div style="font-size:12px;color:var(--text);font-weight:500">' +
          _escape(m.label) +
          '</div>' +
          '<div style="font-size:10px;color:var(--text-muted)">' +
          _escape(m.desc) +
          '</div>' +
          '</div>' +
          '</label>'
        );
      })
      .join('');

    el.querySelectorAll('input[name="ap-sort-mode"]').forEach(function (radio) {
      radio.onchange = function () {
        _sortMode = radio.value;
        _renderSortControls();
        _renderInfo();
        if (_callbacks.onSortModeChange) {
          _callbacks.onSortModeChange(_sortMode);
        }
      };
    });
  }

  // ================================================================
  // Sort Controls
  // ================================================================

  function _getSortFieldOptions() {
    if (_sortMode === 'in_cluster') {
      var fields = [];
      if (_histogramReady) {
        Object.keys(IN_CLUSTER_FIELDS.histogram).forEach(function (k) {
          if (_availableSortFields.indexOf(k) !== -1) {
            fields.push({ value: k, label: IN_CLUSTER_FIELDS.histogram[k] });
          }
        });
      }
      if (_qualityEdgeReady) {
        Object.keys(IN_CLUSTER_FIELDS.quality_edge).forEach(function (k) {
          if (_availableSortFields.indexOf(k) !== -1) {
            fields.push({ value: k, label: IN_CLUSTER_FIELDS.quality_edge[k] });
          }
        });
      }
      return fields;
    } else if (_sortMode === 'cluster') {
      return Object.keys(CLUSTER_FIELDS).map(function (k) {
        return { value: k, label: CLUSTER_FIELDS[k] };
      });
    } else {
      // global — same as in_cluster but all available
      var fields = [];
      if (_histogramReady) {
        Object.keys(IN_CLUSTER_FIELDS.histogram).forEach(function (k) {
          if (_availableSortFields.indexOf(k) !== -1) {
            fields.push({ value: k, label: 'Hist: ' + IN_CLUSTER_FIELDS.histogram[k] });
          }
        });
      }
      if (_qualityEdgeReady) {
        Object.keys(IN_CLUSTER_FIELDS.quality_edge).forEach(function (k) {
          if (_availableSortFields.indexOf(k) !== -1) {
            fields.push({ value: k, label: 'QE: ' + IN_CLUSTER_FIELDS.quality_edge[k] });
          }
        });
      }
      return fields;
    }
  }

  function _renderSortControls() {
    var el = _drawerEl && _drawerEl.querySelector('.ap-sort-controls');
    if (!el) return;

    var fields = _getSortFieldOptions();
    var hasAnalysis = _histogramReady || _qualityEdgeReady;

    if (!hasAnalysis && _sortMode !== 'cluster') {
      el.innerHTML =
        '<div style="font-size:12px;color:var(--text-muted);padding:8px 0">' +
        '尚无分析数据, 请先生成直方图或质量/边缘缓存' +
        '</div>';
      return;
    }

    if (_sortMode === 'cluster') {
      // Cluster sort: no label filter, simple field selection
      el.innerHTML =
        '<div style="margin-bottom:8px">' +
        '<label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">排序字段</label>' +
        '<select class="ap-field" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:12px;outline:none">' +
        fields
          .map(function (f) {
            var sel = f.value === _sortField ? 'selected' : '';
            return '<option value="' + _escape(f.value) + '" ' + sel + '>' + _escape(f.label) + '</option>';
          })
          .join('') +
        '</select>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<label style="font-size:11px;color:var(--text-muted)">顺序</label>' +
        '<select class="ap-order" style="padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:11px;outline:none">' +
        '<option value="desc" ' +
        (_sortOrder === 'desc' ? 'selected' : '') +
        '>↓ 降序</option>' +
        '<option value="asc" ' +
        (_sortOrder === 'asc' ? 'selected' : '') +
        '>↑ 升序</option>' +
        '</select>' +
        '</div>';
    } else {
      // In-cluster or global: field + order + label filter
      el.innerHTML =
        '<div style="margin-bottom:8px">' +
        '<label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">排序字段</label>' +
        '<select class="ap-field" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:12px;outline:none">' +
        '<option value="">— 不排序 —</option>' +
        fields
          .map(function (f) {
            var sel = f.value === _sortField ? 'selected' : '';
            return '<option value="' + _escape(f.value) + '" ' + sel + '>' + _escape(f.label) + '</option>';
          })
          .join('') +
        '</select>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<label style="font-size:11px;color:var(--text-muted)">顺序</label>' +
        '<select class="ap-order" style="padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:11px;outline:none">' +
        '<option value="desc" ' +
        (_sortOrder === 'desc' ? 'selected' : '') +
        '>↓ 降序</option>' +
        '<option value="asc" ' +
        (_sortOrder === 'asc' ? 'selected' : '') +
        '>↑ 升序</option>' +
        '</select>' +
        '</div>' +
        '<div>' +
        '<label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">标签筛选</label>' +
        '<select class="ap-label" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:12px;outline:none">' +
        LABEL_OPTIONS
          .map(function (o) {
            var sel = o.value === _filterLabel ? 'selected' : '';
            return '<option value="' + _escape(o.value) + '" ' + sel + '>' + _escape(o.label) + '</option>';
          })
          .join('') +
        '</select>' +
        '</div>';
    }

    // Wire events
    var fieldEl = el.querySelector('.ap-field');
    var orderEl = el.querySelector('.ap-order');
    var labelEl = el.querySelector('.ap-label');

    function _fireChange() {
      _sortField = fieldEl ? fieldEl.value : '';
      _sortOrder = orderEl ? orderEl.value : 'desc';
      _filterLabel = labelEl ? labelEl.value : '';
      _renderInfo();

      // Determine which callback to fire
      if (_sortMode === 'global') {
        if (_callbacks.onGlobalSortChange) {
          _callbacks.onGlobalSortChange({
            field: _sortField || null,
            order: _sortOrder,
            label: _filterLabel || null,
          });
        }
      } else if (_sortMode === 'in_cluster') {
        if (_callbacks.onInClusterSortChange) {
          _callbacks.onInClusterSortChange({
            field: _sortField || null,
            order: _sortOrder,
            label: _filterLabel || null,
          });
        }
      } else if (_sortMode === 'cluster') {
        if (_callbacks.onClusterSortChange) {
          _callbacks.onClusterSortChange({
            field: _sortField || null,
            order: _sortOrder,
          });
        }
      }
    }

    if (fieldEl) fieldEl.onchange = _fireChange;
    if (orderEl) orderEl.onchange = _fireChange;
    if (labelEl) labelEl.onchange = _fireChange;
  }

  // ================================================================
  // Info
  // ================================================================

  function _renderInfo() {
    var el = _drawerEl && _drawerEl.querySelector('.ap-info');
    if (!el) return;

    var lines = [];

    if (_sortMode === 'in_cluster') {
      lines.push('簇内排序只影响视图, 不改变簇归属。');
      lines.push('排序结果不会保存。');
    } else if (_sortMode === 'cluster') {
      lines.push('对簇卡片整体排序。');
      lines.push('不会改变簇内图片。');
    } else if (_sortMode === 'global') {
      lines.push('全局视图不保存簇结构。');
      lines.push('切回整理视图后簇不变。');
    }

    el.innerHTML =
      '<div style="font-size:11px;color:var(--text-muted);line-height:1.5">' +
      lines
        .map(function (l) {
          return '<div>• ' + _escape(l) + '</div>';
        })
        .join('') +
      '</div>';
  }

  // ================================================================
  // 加载状态并更新
  // ================================================================

  async function _loadStatusAndRefresh() {
    try {
      var status = await _fetchAnalysisStatus(_jobId);
      _histogramReady = status.histogram_ready || false;
      _qualityEdgeReady = status.quality_edge_ready || false;
      _availableSortFields = status.available_sort_fields || [];
      _availableFilterLabels = status.available_filter_labels || [];

      if (_drawerEl) {
        _renderCacheStatus();
        _renderSortControls();
        _renderInfo();
      }
    } catch (e) {
      console.warn('[AnalysisPanel] Failed to load status:', e.message);
    }
  }

  // ================================================================
  // Public API
  // ================================================================

  window.AnalysisPanel = {
    /** 打开分析面板 */
    open: function (jobId, callbacks) {
      if (!jobId) {
        _toast('无有效 job ID', 'error');
        return;
      }

      // Close existing
      if (_drawerEl) _closeDrawer();

      _jobId = jobId;
      _callbacks = callbacks || {};
      _sortMode = 'in_cluster';

      _renderDrawer();
      _loadStatusAndRefresh();
    },

    /** 关闭分析面板 */
    close: function () {
      _closeDrawer();
    },

    /** 当前分析面板是否打开 */
    isOpen: function () {
      return !!_drawerEl;
    },

    /** 获取当前排序状态 */
    getSortState: function () {
      return {
        mode: _sortMode,
        field: _sortField,
        order: _sortOrder,
        label: _filterLabel,
        histogramReady: _histogramReady,
        qualityEdgeReady: _qualityEdgeReady,
      };
    },

    /** 设置排序状态 (由外部触发) */
    setSortState: function (state) {
      if (state.mode) _sortMode = state.mode;
      if (state.field !== undefined) _sortField = state.field;
      if (state.order) _sortOrder = state.order;
      if (state.label !== undefined) _filterLabel = state.label;

      if (_drawerEl) {
        _renderSortModes();
        _renderSortControls();
        _renderInfo();
      }
    },

    /** 刷新分析缓存状态 */
    refreshStatus: function () {
      return _loadStatusAndRefresh();
    },

    /** 当前是否是全局分析视图 */
    isGlobalView: function () {
      return _sortMode === 'global';
    },
  };
})();
