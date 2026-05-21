// Shared in-memory session store — masks created in Mask Generator
// appear in Texture Editor's Masks panel.
window.SessionStore = {
  sessionMasks: [],  // {id, name, dataUrl, img (loaded), thumb}
  _listeners: [],
  add(name, dataUrl) {
    const id = Date.now() + Math.random();
    const img = new Image();
    img.src = dataUrl;
    const item = { id, name, dataUrl, img, thumb: dataUrl };
    this.sessionMasks.push(item);
    this._fire();
    return item;
  },
  remove(id) {
    this.sessionMasks = this.sessionMasks.filter(m => m.id !== id);
    this._fire();
  },
  onChange(fn) { this._listeners.push(fn); },
  _fire() { this._listeners.forEach(fn => fn()); }
};
