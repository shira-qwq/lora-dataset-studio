/* ReclusterPreview — v4.5 安全重聚类预览 Modal
 *
 * 功能:
 * 1. 选择 recipe, 创建预览
 * 2. 列出已有 previews
 * 3. 查看 metrics / diff 对比
 * 4. 应用 preview (含 manual edits 保护)
 *
 * 依赖: Confirm (confirm-dialog.js), Toast (toast.js), JobStore, apiBase()
 * 如果 Confirm/Toast 不存在, 会自动降级为 window.confirm / console
 *
 * API contract: 见 docs/RECLUSTER_PREVIEW_API_CONTRACT_V4_5.md
 */

(function () {
  'use strict';

  // ================================================================
  // 常量
  // ================================================================

  const API_PREFIX = '/api/v1/jobs';

  // Fallback recipes (当后端无 recipe list 接口时使用)
  const FALLBACK_RECIPES = [
    {
      name: 'default_legacy16_raw_015',
      label: '默认稳定 16 维',
      description: '当前验证通过的稳定默认配置',
    },
    {
      name: 'preview_high_granularity',
      label: '更细分',
      description: '预览更多簇，可能更碎',
    },
    {
      name: 'preview_low_granularity',
      label: '更粗分',
      description: '预览更少簇，可能更合并',
    },
  ];

  // ================================================================
  // 内部状态
  // ================================================================

  let _modalEl = null;
  let _jobId = null;
  let _previews = [];
  let _selectedPreviewId = null;
  let _previewDetail = null;
  let _creatingPreview = false;
  let _loadingDetail = false;

  // ================================================================
  // 工具函数
  // ================================================================

  function _apiUrl(path) {
    const base = typeof apiBase === 'function' ? apiBase() : 'http://127.0.0.1:8003/api/v1';
    return base + path;
  }

  function _escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function _fmtPct(v) {
    if (v == null || v === '' || isNaN(Number(v))) return '—';
    return (Number(v) * 100).toFixed(1) + '%';
  }

  function _fmtNum(v) {
    if (v == null || v === '' || isNaN(Number(v))) return '—';
    return Number(v).toLocaleString();
  }

  function _fmtDateTime(s) {
    if (!s) return '—';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return s;
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_) {
      return s;
    }
  }

  function _fmtLabel(name) {
    const found = FALLBACK_RECIPES.find(function (r) { return r.name === name; });
    return found ? found.label : name;
  }

  function _toast(msg, type) {
    if (typeof Toast !== 'undefined' && Toast[type]) {
      Toast[type](msg);
    } else if (type === 'error') {
      console.error('[ReclusterPreview]', msg);
    } else {
      console.log('[ReclusterPreview]', msg);
    }
  }

  function _confirm(title, message, opts) {
    if (typeof Confirm !== 'undefined' && Confirm.ask) {
      return Confirm.ask(title, message, opts);
    }
    return Promise.resolve(window.confirm(title + '\n\n' + message));
  }

  // ================================================================
  // Normalize 函数 (字段兼容)
  // ================================================================

  function normalizePreviewSummary(raw) {
    var m = raw.metrics || {};
    var d = raw.diff_summary || {};
    return {
      previewId: raw.preview_id || m.preview_id || '',
      recipeName: raw.recipe_name || m.recipe_name || '',
      createdAt: m.created_at || '',
      clusterCount: m.n_clusters,
      noiseRate: m.noise_rate,
      silhouette: m.silhouette,
      largestClusterRatio: m.largest_cluster_ratio,
      changedImageCount: d.changed_cluster_count,
      changedImageRatio: d.changed_cluster_ratio,
      totalImages: d.total_images,
    };
  }

  function normalizePreviewDetail(raw) {
    var preview = raw.preview || raw;
    var metrics = preview.preview_metrics || preview.metrics || {};
    var diff = preview.diff_vs_current || preview.diff || {};
    return {
      previewId: preview.preview_id || metrics.preview_id || '',
      recipeName: (preview.recipe || {}).recipe_name || metrics.recipe_name || '',
      createdAt: metrics.created_at || '',
      metrics: {
        silhouette: metrics.silhouette,
        nClusters: metrics.n_clusters,
        noiseRate: metrics.noise_rate,
        largestClusterRatio: metrics.largest_cluster_ratio,
        liveFeatures: metrics.live_features,
        deadFeatures: metrics.dead_features || [],
        aliveFeatureNames: metrics.alive_feature_names || [],
      },
      diff: {
        totalImages: diff.total_images,
        changedImageCount: diff.changed_cluster_count,
        changedImageRatio: diff.changed_cluster_ratio,
        oldClusterCount: diff.old_cluster_count,
        newClusterCount: diff.new_cluster_count,
        oldNoiseRate: diff.old_noise_rate,
        newNoiseRate: diff.new_noise_rate,
        oldLargestClusterRatio: diff.old_largest_cluster_ratio,
        newLargestClusterRatio: diff.new_largest_cluster_ratio,
      },
    };
  }

  // ================================================================
  // API Client
  // ================================================================

  function ManualEditsError(message, payload) {
    this.name = 'ManualEditsError';
    this.message = message || 'Manual edits detected';
    this.status = 409;
    this.payload = payload;
  }
  ManualEditsError.prototype = Object.create(Error.prototype);

  async function _apiFetch(url, options) {
    var resp = await fetch(url, options);
    if (resp.status === 409) {
      var body;
      try { body = await resp.json(); } catch (_) { body = null; }
      throw new ManualEditsError(
        (body && body.detail) || 'Job has manual edits',
        body
      );
    }
    if (!resp.ok) {
      var errBody;
      try {
        errBody = await resp.json();
      } catch (_) {
        errBody = null;
      }
      throw new Error(
        (errBody && errBody.detail) || ('HTTP ' + resp.status + ' ' + resp.statusText)
      );
    }
    return resp.json();
  }

  async function listPreviews(jobId) {
    var data = await _apiFetch(_apiUrl(API_PREFIX + '/' + encodeURIComponent(jobId) + '/recluster/previews'));
    return data.previews || [];
  }

  async function createPreview(jobId, recipeName) {
    var data = await _apiFetch(
      _apiUrl(API_PREFIX + '/' + encodeURIComponent(jobId) + '/recluster/preview'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe_name: recipeName }),
      }
    );
    return data;
  }

  async function getPreviewDetail(jobId, previewId) {
    var data = await _apiFetch(
      _apiUrl(
        API_PREFIX +
          '/' +
          encodeURIComponent(jobId) +
          '/recluster/previews/' +
          encodeURIComponent(previewId)
      )
    );
    return data;
  }

  async function applyPreview(jobId, previewId, opts) {
    opts = opts || {};
    var data = await _apiFetch(
      _apiUrl(
        API_PREFIX +
          '/' +
          encodeURIComponent(jobId) +
          '/recluster/previews/' +
          encodeURIComponent(previewId) +
          '/apply'
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: !!opts.force }),
      }
    );
    return data;
  }

  // ================================================================
  // 风险分析
  // ================================================================

  function analyzeRisk(detail) {
    var dif = detail.diff || {};
    var met = detail.metrics || {};
    var warnings = [];
    var errors = [];

    var changedRatio = dif.changedImageRatio;
    if (changedRatio != null) {
      if (changedRatio > 0.4) {
        errors.push('超过 40% 的图片会改变簇归属，属于重大变化');
      } else if (changedRatio > 0.25) {
        warnings.push('超过 25% 的图片会改变簇归属');
      }
    }

    var newNoise = dif.newNoiseRate;
    var oldNoise = dif.oldNoiseRate;
    if (newNoise != null && oldNoise != null) {
      if (newNoise > 35) {
        errors.push('新聚类的 noise 率超过 35%，可能过度分割');
      } else if (newNoise > oldNoise + 10) {
        warnings.push('新聚类的 noise 率比当前高出超过 10%');
      }
    }

    var newLcr = dif.newLargestClusterRatio;
    if (newLcr != null) {
      if (newLcr > 0.55) {
        errors.push('最大簇占比超过 55%，可能出现严重不平衡');
      } else if (newLcr > 0.45) {
        warnings.push('最大簇占比超过 45%');
      }
    }

    var oldCc = dif.oldClusterCount;
    var newCc = dif.newClusterCount;
    if (oldCc != null && newCc != null && oldCc > 0) {
      var changePct = Math.abs(newCc - oldCc) / oldCc;
      if (changePct > 0.5) {
        warnings.push('簇数量变化超过 50%');
      }
    }

    return { warnings: warnings, errors: errors };
  }

  // ================================================================
  // Modal Rendering
  // ================================================================

  function _renderModal() {
    // 移除已有 modal
    var existing = document.getElementById('rp-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'rp-modal';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99998;display:flex;align-items:center;justify-content:center';

    overlay.innerHTML =
      '<div class="rp-surface" style="' +
      'background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;' +
      'width:min(900px,calc(100vw - 48px));height:min(600px,calc(100vh - 80px));' +
      'display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.5);overflow:hidden' +
      '">' +
      // Header
      '<div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">' +
      '<span style="font-size:15px;font-weight:600;color:var(--text)">🔬 重聚类预览</span>' +
      '<span style="flex:1"></span>' +
      '<button class="rp-close" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px 8px">&times;</button>' +
      '</div>' +
      // Body: two columns
      '<div style="flex:1;display:flex;overflow:hidden">' +
      // Left column
      '<div class="rp-left" style="width:280px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden">' +
      // Recipe section
      '<div style="padding:12px;border-bottom:1px solid var(--border)">' +
      '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px">选择 Recipe</div>' +
      '<select class="rp-recipe-select" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:12px;outline:none;margin-bottom:6px">' +
      FALLBACK_RECIPES.map(function (r) {
        return (
          '<option value="' +
          _escape(r.name) +
          '">' +
          _escape(r.label) +
          '</option>'
        );
      }).join('') +
      '</select>' +
      '<button class="rp-create-btn" style="width:100%;padding:6px 0;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500">创建预览</button>' +
      '</div>' +
      // Previews list
      '<div style="flex:1;overflow-y:auto;padding:8px 0">' +
      '<div style="padding:0 12px 6px;font-size:11px;font-weight:600;color:var(--text-muted)">已有预览</div>' +
      '<div class="rp-list"></div>' +
      '</div>' +
      '</div>' +
      // Right column
      '<div class="rp-right" style="flex:1;overflow-y:auto;padding:16px">' +
      '<div class="rp-detail">' +
      '<div style="text-align:center;padding:40px 16px;color:var(--text-muted);font-size:13px">请选择或创建一个预览</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    _modalEl = overlay;
    document.body.appendChild(overlay);

    // Event: close
    overlay.querySelector('.rp-close').onclick = function () {
      _closeModal();
    };
    overlay.onclick = function (e) {
      if (e.target === overlay) _closeModal();
    };

    // Event: create preview
    var createBtn = overlay.querySelector('.rp-create-btn');
    var recipeSelect = overlay.querySelector('.rp-recipe-select');

    createBtn.onclick = function () {
      _handleCreatePreview(recipeSelect.value);
    };

    // Load existing previews
    _loadPreviews();
  }

  function _closeModal() {
    if (_modalEl) {
      _modalEl.remove();
      _modalEl = null;
    }
    _previews = [];
    _selectedPreviewId = null;
    _previewDetail = null;
    _creatingPreview = false;
    _loadingDetail = false;
  }

  // ================================================================
  // Data Loading
  // ================================================================

  async function _loadPreviews() {
    var listEl = _modalEl && _modalEl.querySelector('.rp-list');
    if (!listEl) return;

    listEl.innerHTML =
      '<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center">加载中...</div>';

    try {
      _previews = await listPreviews(_jobId);
    } catch (e) {
      _previews = [];
      _toast('加载 previews 失败: ' + e.message, 'error');
    }

    _renderPreviewList();

    // If we have a selected preview, reload its detail
    if (_selectedPreviewId) {
      var stillExists = _previews.some(function (p) {
        return (p.preview_id || (p.metrics && p.metrics.preview_id)) === _selectedPreviewId;
      });
      if (stillExists) {
        _loadDetail(_selectedPreviewId);
      } else {
        _selectedPreviewId = null;
        _previewDetail = null;
        _renderDetail(null);
      }
    } else if (_previews.length > 0) {
      // Auto-select newest
      var newest = _previews[_previews.length - 1];
      _selectedPreviewId = newest.preview_id || (newest.metrics && newest.metrics.preview_id);
      _loadDetail(_selectedPreviewId);
    }
  }

  function _renderPreviewList() {
    var listEl = _modalEl && _modalEl.querySelector('.rp-list');
    if (!listEl) return;

    if (!_previews.length) {
      listEl.innerHTML =
        '<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center">还没有预览，请选择 recipe 后创建</div>';
      return;
    }

    listEl.innerHTML = _previews
      .map(function (raw) {
        var n = normalizePreviewSummary(raw);
        var isSelected = n.previewId === _selectedPreviewId;
        var selStyle = isSelected
          ? 'background:var(--bg);border-left:3px solid var(--accent);'
          : '';

        // Determine color based on risk
        if (n.changedImageRatio > 0.4) {
          var riskColor = 'var(--error)';
        } else if (n.changedImageRatio > 0.25) {
          var riskColor = 'var(--warning)';
        } else {
          var riskColor = 'var(--success)';
        }

        return (
          '<div class="rp-preview-item" data-preview-id="' +
          _escape(n.previewId) +
          '" style="padding:8px 12px;cursor:pointer;font-size:12px;' +
          selStyle +
          'border-bottom:1px solid var(--border);transition:background 0.1s">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
          '<span style="width:6px;height:6px;border-radius:50%;background:' +
          riskColor +
          ';flex-shrink:0"></span>' +
          '<span style="font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          _escape(_fmtLabel(n.recipeName)) +
          '</span>' +
          '</div>' +
          '<div style="display:flex;gap:8px;font-size:10px;color:var(--text-muted)">' +
          '<span>' +
          (n.clusterCount != null ? n.clusterCount + ' 簇' : '') +
          '</span>' +
          (n.silhouette != null ? '<span>Sil: ' + n.silhouette.toFixed(3) + '</span>' : '') +
          (n.changedImageRatio != null
            ? '<span style="color:' + riskColor + '">' + _fmtPct(n.changedImageRatio) + '</span>'
            : '') +
          '</div>' +
          '<div style="font-size:10px;color:var(--text-muted)">' +
          _escape(_fmtDateTime(n.createdAt)) +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    // Click handlers
    listEl.querySelectorAll('.rp-preview-item').forEach(function (el) {
      el.onclick = function () {
        var pid = el.dataset.previewId;
        if (pid) {
          _selectedPreviewId = pid;
          _renderPreviewList();
          _loadDetail(pid);
        }
      };
      el.onmouseover = function () {
        if (!el.dataset.previewId === _selectedPreviewId) {
          el.style.background = 'var(--bg-elev)';
        }
      };
      el.onmouseout = function () {
        el.style.background = '';
      };
    });
  }

  async function _loadDetail(previewId) {
    if (_loadingDetail) return;
    _loadingDetail = true;

    var detailEl = _modalEl && _modalEl.querySelector('.rp-detail');
    if (!detailEl) return;

    detailEl.innerHTML =
      '<div style="text-align:center;padding:40px 16px;color:var(--text-muted);font-size:13px">加载详情中...</div>';

    try {
      var raw = await getPreviewDetail(_jobId, previewId);
      _previewDetail = normalizePreviewDetail(raw);
    } catch (e) {
      _previewDetail = null;
      detailEl.innerHTML =
        '<div style="padding:24px;color:var(--error);font-size:13px;text-align:center">加载失败: ' +
        _escape(e.message) +
        '</div>';
      _loadingDetail = false;
      return;
    }

    _renderDetail(_previewDetail);
    _loadingDetail = false;
  }

  // ================================================================
  // Detail Rendering
  // ================================================================

  function _renderDetail(detail) {
    var detailEl = _modalEl && _modalEl.querySelector('.rp-detail');
    if (!detailEl) return;

    if (!detail) {
      detailEl.innerHTML =
        '<div style="text-align:center;padding:40px 16px;color:var(--text-muted);font-size:13px">请选择或创建一个预览</div>';
      return;
    }

    var met = detail.metrics || {};
    var dif = detail.diff || {};
    var risk = analyzeRisk(detail);
    var hasRisk = risk.warnings.length > 0 || risk.errors.length > 0;

    // Build risk HTML
    var riskHtml = '';
    if (hasRisk) {
      var items = '';
      risk.errors.forEach(function (msg) {
        items +=
          '<div style="color:var(--error);font-size:12px;padding:2px 0">⚠ ' +
          _escape(msg) +
          '</div>';
      });
      risk.warnings.forEach(function (msg) {
        items +=
          '<div style="color:var(--warning);font-size:12px;padding:2px 0">⚠ ' +
          _escape(msg) +
          '</div>';
      });
      riskHtml =
        '<div style="background:rgba(255,183,77,0.08);border:1px solid var(--warning);border-radius:6px;padding:10px 14px;margin-bottom:12px">' +
        '<div style="font-size:12px;font-weight:600;color:var(--warning);margin-bottom:4px">风险提示</div>' +
        items +
        '</div>';
    }

    // Metrics comparison table
    function _row(label, current, preview, fmt) {
      fmt = fmt || _fmtNum;
      return (
        '<tr>' +
        '<td style="padding:4px 8px;font-size:12px;color:var(--text-soft);border-bottom:1px solid var(--border)">' +
        _escape(label) +
        '</td>' +
        '<td style="padding:4px 8px;font-size:12px;color:var(--text);text-align:center;border-bottom:1px solid var(--border)">' +
        fmt(current) +
        '</td>' +
        '<td style="padding:4px 8px;font-size:12px;color:var(--text);text-align:center;border-bottom:1px solid var(--border);font-weight:500">' +
        fmt(preview) +
        '</td>' +
        '</tr>'
      );
    }

    var metricsTable =
      '<table style="width:100%;border-collapse:collapse;margin-bottom:12px">' +
      '<thead><tr>' +
      '<th style="padding:4px 8px;font-size:11px;font-weight:600;color:var(--text-muted);text-align:left;border-bottom:2px solid var(--border)">指标</th>' +
      '<th style="padding:4px 8px;font-size:11px;font-weight:600;color:var(--text-muted);text-align:center;border-bottom:2px solid var(--border)">当前</th>' +
      '<th style="padding:4px 8px;font-size:11px;font-weight:600;color:var(--accent);text-align:center;border-bottom:2px solid var(--border)">预览</th>' +
      '</tr></thead>' +
      '<tbody>' +
      _row('簇数量', dif.oldClusterCount, dif.newClusterCount) +
      _row('Noise 率', dif.oldNoiseRate, dif.newNoiseRate, function (v) {
        return v != null ? v.toFixed(1) + '%' : '—';
      }) +
      _row('Silhouette', '—', met.silhouette, function (v) {
        return v != null ? v.toFixed(4) : '—';
      }) +
      _row('最大簇占比', dif.oldLargestClusterRatio, dif.newLargestClusterRatio, _fmtPct) +
      _row('变化图片', '—', dif.changedImageCount, function (v) {
        if (v == null) return '—';
        var total = dif.totalImages;
        var pct = dif.changedImageRatio;
        var label = _fmtNum(v);
        if (total != null) label += ' / ' + _fmtNum(total);
        if (pct != null) label += ' (' + _fmtPct(pct) + ')';
        return label;
      }) +
      '</tbody></table>';

    // Live / dead features
    var featHtml = '';
    if (met.aliveFeatureNames && met.aliveFeatureNames.length) {
      featHtml +=
        '<div style="margin-bottom:4px">' +
        '<span style="font-size:11px;color:var(--text-muted)">特征: </span>' +
        '<span style="font-size:11px;color:var(--text)">' +
        _escape(met.aliveFeatureNames.join(', ')) +
        '</span>' +
        '</div>';
    }
    if (met.deadFeatures && met.deadFeatures.length) {
      featHtml +=
        '<div style="margin-bottom:4px">' +
        '<span style="font-size:11px;color:var(--text-muted)">死亡特征: </span>' +
        '<span style="font-size:11px;color:var(--error)">' +
        _escape(met.deadFeatures.join(', ')) +
        '</span>' +
        '</div>';
    }

    detailEl.innerHTML =
      '<div>' +
      riskHtml +
      '<div style="margin-bottom:8px">' +
      '<span style="font-size:14px;font-weight:600;color:var(--text)">' +
      _escape(_fmtLabel(detail.recipeName)) +
      '</span>' +
      '<span style="font-size:11px;color:var(--text-muted);margin-left:8px">' +
      _escape(_fmtDateTime(detail.createdAt)) +
      '</span>' +
      '</div>' +
      metricsTable +
      featHtml +
      '<div style="margin-top:16px;display:flex;gap:8px">' +
      '<button class="rp-apply-btn" style="padding:8px 20px;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500">应用此预览</button>' +
      '<button class="rp-cancel-btn" style="padding:8px 20px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:13px">关闭</button>' +
      '</div>' +
      '</div>';

    // Apply handler
    detailEl.querySelector('.rp-apply-btn').onclick = function () {
      _handleApply(detail);
    };
    detailEl.querySelector('.rp-cancel-btn').onclick = function () {
      _closeModal();
    };
  }

  // ================================================================
  // Create Preview
  // ================================================================

  async function _handleCreatePreview(recipeName) {
    if (_creatingPreview) return;
    _creatingPreview = true;

    var btn = _modalEl && _modalEl.querySelector('.rp-create-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '生成中...';
    }

    try {
      var result = await createPreview(_jobId, recipeName);
      _toast('预览 "' + _fmtLabel(recipeName) + '" 创建成功', 'success');

      // Reload list and auto-select new preview
      await _loadPreviews();

      // Auto-select the new preview
      if (result.preview_id) {
        _selectedPreviewId = result.preview_id;
        _loadDetail(result.preview_id);
      }
    } catch (e) {
      _toast('创建预览失败: ' + e.message, 'error');
    } finally {
      _creatingPreview = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '创建预览';
      }
    }
  }

  // ================================================================
  // Apply Preview
  // ================================================================

  async function _handleApply(detail) {
    if (!detail) return;
    var dif = detail.diff || {};
    var met = detail.metrics || {};

    // Build confirmation message
    var msg =
      'Recipe: ' + _fmtLabel(detail.recipeName) + '\n' +
      '簇数量: ' +
      (dif.oldClusterCount != null ? dif.oldClusterCount : '—') +
      ' → ' +
      (dif.newClusterCount != null ? dif.newClusterCount : '—') +
      '\n' +
      'Noise 率: ' +
      (dif.oldNoiseRate != null ? dif.oldNoiseRate.toFixed(1) + '%' : '—') +
      ' → ' +
      (dif.newNoiseRate != null ? dif.newNoiseRate.toFixed(1) + '%' : '—') +
      '\n' +
      '最大簇占比: ' +
      (dif.oldLargestClusterRatio != null ? _fmtPct(dif.oldLargestClusterRatio) : '—') +
      ' → ' +
      (dif.newLargestClusterRatio != null ? _fmtPct(dif.newLargestClusterRatio) : '—') +
      '\n' +
      '变化图片: ' +
      (dif.changedImageCount != null ? _fmtNum(dif.changedImageCount) : '—') +
      (dif.totalImages != null ? ' / ' + _fmtNum(dif.totalImages) : '') +
      (dif.changedImageRatio != null ? ' (' + _fmtPct(dif.changedImageRatio) + ')' : '') +
      '\n\n' +
      '应用后会把该 preview 作为新的 active clustering。\n' +
      '不会自动保留当前视图排序/筛选状态。';

    var confirmed = await _confirm('应用预览', msg, {
      yesText: '应用预览',
      noText: '取消',
      danger: true,
    });
    if (!confirmed) return;

    try {
      var result = await applyPreview(_jobId, _selectedPreviewId, { force: false });
      _toast('预览已应用为当前聚类', 'success');
      _closeModal();

      // Notify organize workspace to reload
      window.dispatchEvent(
        new CustomEvent('organize-reload', {
          detail: { reason: 'recluster-preview-applied' },
        })
      );
    } catch (e) {
      if (e instanceof ManualEditsError) {
        // Second confirmation for force
        var forceMsg =
          '检测到当前 job 已有人工整理/移动/重命名状态。\n' +
          '强制应用可能覆盖当前整理结果。\n' +
          '建议先导出或确认已经备份。\n' +
          '只有确定要覆盖时才继续。\n\n' +
          '已为你自动备份当前聚类状态到 _backup_before_apply_ 目录。';

        var forceConfirmed = await _confirm('确认强制覆盖', forceMsg, {
          yesText: '强制应用并备份',
          noText: '取消',
          danger: true,
        });
        if (!forceConfirmed) return;

        try {
          var forceResult = await applyPreview(_jobId, _selectedPreviewId, { force: true });
          _toast('预览已强制应用（包含备份）', 'success');
          _closeModal();
          window.dispatchEvent(
            new CustomEvent('organize-reload', {
              detail: { reason: 'recluster-preview-applied' },
            })
          );
        } catch (forceErr) {
          _toast('强制应用失败: ' + forceErr.message, 'error');
        }
      } else {
        _toast('应用预览失败: ' + e.message, 'error');
      }
    }
  }

  // ================================================================
  // Public API
  // ================================================================

  window.ReclusterPreview = {
    /** 打开重聚类预览 modal */
    open: function (jobId) {
      if (!jobId) {
        _toast('无有效 job ID', 'error');
        return;
      }
      _jobId = jobId;
      _previews = [];
      _selectedPreviewId = null;
      _previewDetail = null;
      _creatingPreview = false;
      _loadingDetail = false;
      _renderModal();
    },
  };
})();
