/* SelectionStore — 全局唯一选区状态
 *
 * 替代旧的 SelectionManager + 各 workspace 私有 _selectedImages
 * 所有 workspace 共享同一份选区
 */

const SelectionStore = {
  _selected: new Set(),
  _listeners: new Set(),

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },

  _emit() {
    const ids = this.getAll();
    this._listeners.forEach(fn => fn(ids));
  },

  toggle(id) {
    if (this._selected.has(id)) this._selected.delete(id);
    else this._selected.add(id);
    this._emit();
  },

  select(ids) {
    this._selected = new Set(ids);
    this._emit();
  },

  add(ids) {
    for (const id of ids) this._selected.add(id);
    this._emit();
  },

  clear() {
    this._selected.clear();
    this._emit();
  },

  has(id) {
    return this._selected.has(id);
  },

  getAll() {
    return Array.from(this._selected);
  },

  get size() {
    return this._selected.size;
  }
};
