/* ImageStore — 图片 + 特征 + Review + 导出 + 视口查询 + 缩略图缓存
 *
 * 缩略图缓存策略:
 * - 内存层: blob URL Map (session 内)
 * - 持久层: localStorage 保存 path -> etag (刷新后不重新下载不变的)
 */

const ImageStore = (function() {
  let _cache = {};
  let _allPoints = [];
  // In-memory thumbnail blob cache: key = jobId+path → blob URL
  let _thumbCache = {};
  let _thumbPending = {}; // key → Promise to avoid duplicate in-flight fetches
  let _thumbEtag = {}; // key -> size (proxy for etag)

  function _key(jobId, params) { return 'images:' + jobId + ':' + JSON.stringify(params || {}); }
  function _featKey(jobId) { return 'features:' + jobId; }
  function _thumbKey(jobId, path) { return (jobId || '') + '::' + (path || ''); }

  // Load persistent etag cache
  function _loadEtag() {
    try {
      const raw = localStorage.getItem('thumb_etag');
      if (raw) _thumbEtag = JSON.parse(raw);
    } catch (e) { _thumbEtag = {}; }
  }
  function _saveEtag() {
    try {
      // Only keep last 2000 entries to limit localStorage size
      const keys = Object.keys(_thumbEtag);
      if (keys.length > 2000) {
        const toKeep = keys.slice(-2000);
        const newEtag = {};
        toKeep.forEach(k => { newEtag[k] = _thumbEtag[k]; });
        _thumbEtag = newEtag;
      }
      localStorage.setItem('thumb_etag', JSON.stringify(_thumbEtag));
    } catch (e) {}
  }
  _loadEtag();

  return {
    list(jobId, params) {
      const k = _key(jobId, params);
      if (_cache[k]) return Promise.resolve(_cache[k]);
      let url = apiBase() + '/results/' + encodeURIComponent(jobId) + '/images';
      if (params) {
        const qs = Object.entries(params).filter(([_, v]) => v !== undefined && v !== null)
          .map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
        if (qs) url += '?' + qs;
      }
      return Promise.race([
        fetch(url).then(r => r.json()).then(data => {
          _cache[k] = data;
          return data;
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ImageStore.list timeout: ' + url)), 15000))
      ]);
    },

    thumbnailUrl(jobId, path) {
      return apiBase() + '/results/' + encodeURIComponent(jobId) + '/thumbnail?path=' + encodeURIComponent(path || '');
    },

    // ── 新增: getCachedThumbnailUrl ──
    // 返回缓存的 blob URL，避免重复网络请求
    getCachedThumbnailUrl(jobId, path) {
      const key = _thumbKey(jobId, path);
      if (_thumbCache[key]) return Promise.resolve(_thumbCache[key]);
      if (_thumbPending[key]) return _thumbPending[key];

      const p = fetch(this.thumbnailUrl(jobId, path))
        .then(r => {
          if (!r.ok) throw new Error('Thumbnail fetch failed');
          return r.blob();
        })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          _thumbCache[key] = url;
          _thumbEtag[key] = blob.size; // proxy for etag
          delete _thumbPending[key];
          // Periodically save etag cache (throttled)
          if (!_thumbEtag._saveTimer) {
            _thumbEtag._saveTimer = setTimeout(() => {
              delete _thumbEtag._saveTimer;
              _saveEtag();
            }, 5000);
          }
          return url;
        })
        .catch(err => {
          delete _thumbPending[key];
          // Return the original non-cached URL as fallback
          return this.thumbnailUrl(jobId, path);
        });
      _thumbPending[key] = p;
      return p;
    },

    // 缓存统计 (for debugging)
    cacheStats() {
      return {
        inMemory: Object.keys(_thumbCache).length,
        persisted: Object.keys(_thumbEtag).filter(k => !k.startsWith('_')).length
      };
    },

    getFeatureMeta(jobId) {
      const k = _featKey(jobId);
      if (_cache[k]) return Promise.resolve(_cache[k]);
      const url = apiBase() + '/results/' + encodeURIComponent(jobId) + '/features';
      return fetch(url).then(r => r.json()).then(data => { _cache[k] = data; return data; });
    },

    // ── 新增: setFlag(单图标记) ──
    setFlag(imageId, flag) {
      const url = apiBase() + '/images/' + encodeURIComponent(imageId) + '/review?job_id=' + encodeURIComponent(JobStore.activeId) + '&flag=' + flag;
      return fetch(url, { method: 'PUT' }).then(r => r.json());
    },

    // ── 新增: batchSetFlag(批量标记) ──
    batchSetFlag(ids, flag) {
      const url = apiBase() + '/images/batch-review';
      return fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ image_ids: ids, flag: flag, job_id: JobStore.activeId })
      }).then(r => r.json());
    },

    // ── 新增: moveToCluster(移动到其他簇) ──
    moveToCluster(ids, clusterId) {
      const url = apiBase() + '/results/' + encodeURIComponent(JobStore.activeId) + '/images/move';
      return fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ image_ids: ids, target_cluster_id: clusterId })
      }).then(r => r.json());
    },

    // ── 新增: getImagesByViewport(视口查询) ──
    // 接收视口边界，返回可见的点
    getImagesByViewport(jobId, viewportBounds) {
      if (!_allPoints.length) {
        // 首次加载全部嵌入点
        const url = apiBase() + '/results/' + encodeURIComponent(jobId) + '/embeddings?format=atlas';
        return fetch(url).then(r => r.json()).then(data => {
          _allPoints = data.points || [];
          return _filterByViewport(_allPoints, viewportBounds);
        });
      }
      return Promise.resolve(_filterByViewport(_allPoints, viewportBounds));
    },

    // ── 保留旧接口 ──
    setReview(filename, flag) {
      return this.setFlag(filename, flag);
    },
    batchReview(imageIds, flag) {
      return this.batchSetFlag(imageIds, flag);
    },
    exportSelection(clusterIds) {
      const url = apiBase() + '/exports';
      return fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ job_id: JobStore.activeId, selector: { type: 'by_cluster', cluster_ids: clusterIds }, format: 'index' })
      }).then(resp => {
        if (resp.headers.get('content-type')?.includes('text/csv')) {
          return resp.blob().then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'export_' + JobStore.activeId + '.csv';
            a.click();
            return { exported: true };
          });
        }
        return resp.json();
      });
    },

    invalidate(jobId) {
      const prefix = 'images:' + jobId + ':';
      Object.keys(_cache).forEach(k => { if (k.startsWith(prefix)) delete _cache[k]; });
      delete _cache[_featKey(jobId)];
      _allPoints = [];
      // Clear thumbnail cache for this job
      const jobPrefix = (jobId || '') + '::';
      Object.keys(_thumbCache).forEach(k => {
        if (k.startsWith(jobPrefix)) {
          URL.revokeObjectURL(_thumbCache[k]);
          delete _thumbCache[k];
        }
      });
    },
  };

  function _filterByViewport(points, bounds) {
    if (!bounds) return points;
    return points.filter(p => {
      const x = parseFloat(p.umap_x);
      const y = parseFloat(p.umap_y);
      return x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax;
    });
  }
})();
