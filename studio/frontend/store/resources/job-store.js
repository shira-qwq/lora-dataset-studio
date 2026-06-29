/* JobStore — 最小版全局 Job 上下文
 *
 * 职责只有一个：持有当前 activeJob，通知订阅者。
 *
 * 比 full EventBus 方案更简单的理由是：
 *   JobStore 是唯一全局上下文（Workpsace 共享），
 *   不需要通用 EventBus，一个 emit/subscribe 足够。
 *
 * 使用方式:
 *   jobStore.setActive('写真test_output_v7')
 *   jobStore.subscribe(state => { ... })
 *   jobStore.activeId
 */

const JobStore = (function() {
  // ── 私有状态 ──
  let _activeId = localStorage.getItem('activeJob') || '';
  let _listeners = [];

  // ── 内部通知 ──
  function _notify() {
    _listeners.forEach(cb => {
      try { cb({ jobId: _activeId }); } catch(e) { console.warn('JobStore listener error:', e); }
    });
  }

  return {
    /** 设置当前活跃 Job */
    setActive(jobId) {
      if (jobId === _activeId) return;  // 没变就不通知
      _activeId = jobId || '';
      localStorage.setItem('activeJob', _activeId);
      _notify();
    },

    /** 读取当前 Job ID */
    get activeId() { return _activeId; },

    /** 订阅变更 */
    subscribe(callback) {
      _listeners.push(callback);
      // 立即回调一次
      try { callback({ jobId: _activeId }); } catch(e) {}
      return () => {
        _listeners = _listeners.filter(cb => cb !== callback);
      };
    },
  };
})();

// 暴露到全局（Phase 1 过渡期）
window.JobStore = JobStore;
