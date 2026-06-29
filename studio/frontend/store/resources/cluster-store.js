/* ClusterStore — 簇数据 + 健康度 + 缓存 */

const ClusterStore = (function() {
  let _cache = {};
  let _lastJobId = null;

  function _key(jobId) { return 'clusters:' + jobId; }
  function _detailKey(jobId, cid) { return 'cluster:' + jobId + ':' + cid; }
  function _healthKey(jobId) { return 'health:' + jobId; }

  function _fetch(jobId) {
    const k = _key(jobId);
    if (_cache[k]) return Promise.resolve(_cache[k]);
    const url = apiBase() + '/results/' + encodeURIComponent(jobId) + '/clusters';
    return Promise.race([
      fetch(url).then(r => r.json()).then(data => {
        _cache[k] = data.clusters || [];
        return _cache[k];
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ClusterStore timeout: ' + url)), 15000))
    ]);
  }

  return {
    list(jobId) { return _fetch(jobId); },

    get(jobId, clusterId) {
      const k = _detailKey(jobId, clusterId);
      if (_cache[k]) return Promise.resolve(_cache[k]);
      const url = apiBase() + '/results/' + encodeURIComponent(jobId) + '/clusters/' + clusterId;
      return fetch(url).then(r => r.json()).then(data => { _cache[k] = data; return data; });
    },

    getHealth(jobId) {
      const k = _healthKey(jobId);
      if (_cache[k]) return Promise.resolve(_cache[k]);
      const url = apiBase() + '/results/' + encodeURIComponent(jobId) + '/health';
      return fetch(url).then(r => r.json()).then(data => { _cache[k] = data; return data; });
    },

    // ── 新增: getCachedCluster ──
    getCachedCluster(jobId) {
      const k = _key(jobId);
      return _cache[k] ? Promise.resolve(_cache[k]) : this.list(jobId);
    },

    invalidate(jobId) {
      delete _cache[_key(jobId)];
      delete _cache[_healthKey(jobId)];
    },

    // ── 新增: invalidateOnJobSwitch ──
    invalidateOnJobSwitch(jobId) {
      if (_lastJobId && _lastJobId !== jobId) {
        this.invalidate(_lastJobId);
      }
      _lastJobId = jobId;
    },
  };
})();
