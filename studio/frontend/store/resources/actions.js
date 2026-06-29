/* Actions — 统一动作层
 *
 * 所有用户操作收敛为此处的函数：
 *   SelectionStore → Actions.moveToCluster / Actions.review / Actions.suggestCluster
 *
 * 规则：
 *   1. UI 先更新（乐观更新）
 *   2. API 调用
 *   3. SelectionStore.clear()
 */

const Actions = {
  async moveToCluster(clusterId) {
    const ids = SelectionStore.getAll();
    if (!ids.length) return null;

    const jobId = JobStore.activeId;
    if (!jobId) return null;

    try {
      const resp = await fetch(apiBase() + '/results/' + encodeURIComponent(jobId) + '/images/move', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ image_ids: ids, target_cluster_id: clusterId })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'HTTP ' + resp.status }));
        throw new Error(err.detail || err.message || 'HTTP ' + resp.status);
      }
      const result = await resp.json();
      SelectionStore.clear();
      ClusterStore.invalidate(jobId);
      return result;
    } catch (e) {
      console.error('moveToCluster failed:', e);
      throw e;
    }
  },

  async suggestCluster() {
    const ids = SelectionStore.getAll();
    if (!ids.length) return [];

    const jobId = JobStore.activeId;
    if (!jobId) return [];

    try {
      const resp = await fetch(apiBase() + '/results/' + encodeURIComponent(jobId) + '/images/suggest-cluster', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ image_ids: ids })
      });
      return await resp.json();
    } catch (e) {
      console.error('suggestCluster failed:', e);
      return [];
    }
  },

  review(flag) {
    const ids = SelectionStore.getAll();
    if (!ids.length) return;

    const jobId = JobStore.activeId;
    if (!jobId) return;

    fetch(apiBase() + '/images/batch-review', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ image_ids: ids, flag: flag, job_id: jobId })
    }).catch(e => console.error('review failed:', e));

    SelectionStore.clear();
  },

  async createCluster(name) {
    const ids = SelectionStore.getAll();
    if (!ids.length) return;

    const jobId = JobStore.activeId;
    if (!jobId) return;

    try {
      const resp = await fetch(apiBase() + '/results/' + encodeURIComponent(jobId) + '/clusters/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ image_ids: ids, name: name || 'New Cluster ' + (Date.now() % 10000) })
      });
      const res = await resp.json();
      SelectionStore.clear();
      ClusterStore.invalidate(jobId);
      return res;
    } catch (e) {
      console.error('createCluster failed:', e);
    }
  },

  async mergeClusters(sourceClusterId, targetClusterId) {
    const jobId = JobStore.activeId;
    if (!jobId) return;

    try {
      const resp = await fetch(apiBase() + '/results/' + encodeURIComponent(jobId) + '/clusters/' + targetClusterId + '/merge', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ source_cluster_id: sourceClusterId })
      });
      const res = await resp.json();
      ClusterStore.invalidate(jobId);
      return res;
    } catch (e) {
      console.error('mergeClusters failed:', e);
    }
  },

  async renameCluster(clusterId, displayName) {
    const jobId = JobStore.activeId;
    if (!jobId) return;

    try {
      const resp = await fetch(apiBase() + '/results/' + encodeURIComponent(jobId) + '/clusters/' + clusterId, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ display_name: displayName })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'HTTP ' + resp.status }));
        throw new Error(err.detail || 'HTTP ' + resp.status);
      }
      const res = await resp.json();
      ClusterStore.invalidate(jobId);
      return res;
    } catch (e) {
      console.error('renameCluster failed:', e);
      throw e;
    }
  }
};
