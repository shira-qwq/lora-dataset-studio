/* EmbeddingStore — 嵌入点云数据 + 缓存 */

const EmbeddingStore = (function() {
  let _cache = {};
  let _lastJobId = null;

  function _key(jobId) { return 'embeddings:' + jobId; }

  return {
    getPoints(jobId) {
      const k = _key(jobId);
      if (_cache[k]) return Promise.resolve(_cache[k]);
      const url = apiBase() + '/results/' + encodeURIComponent(jobId) + '/embeddings?format=atlas';
      return Promise.race([
        fetch(url).then(r => r.json()).then(data => {
          _cache[k] = data.points || [];
          return _cache[k];
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('EmbeddingStore timeout: ' + url)), 15000))
      ]);
    },

    // ── 新增: getCachedEmbedding ──
    getCachedEmbedding(jobId) {
      const k = _key(jobId);
      return _cache[k] ? Promise.resolve(_cache[k]) : this.getPoints(jobId);
    },

    invalidate(jobId) { delete _cache[_key(jobId)]; },

    // ── 新增: invalidateOnJobSwitch ──
    invalidateOnJobSwitch(jobId) {
      if (_lastJobId && _lastJobId !== jobId) {
        this.invalidate(_lastJobId);
      }
      _lastJobId = jobId;
    },
  };
})();
