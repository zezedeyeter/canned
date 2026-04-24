const { contextBridge, ipcRenderer, webFrame } = require('electron');

const UI_ZOOM_ALLOWED = new Set([90, 100, 120, 140]);
function clampUiZoomPercent(pct) {
  const n = Number(pct);
  return UI_ZOOM_ALLOWED.has(n) ? n : 100;
}

contextBridge.exposeInMainWorld('api', {
  getSnippets: () => ipcRenderer.invoke('get-snippets'),
  addSnippet: (snippet) => ipcRenderer.invoke('add-snippet', snippet),
  updateSnippet: (snippet) => ipcRenderer.invoke('update-snippet', snippet),
  deleteSnippet: (id) => ipcRenderer.invoke('delete-snippet', id),
  reorderSnippets: (ordered) => ipcRenderer.invoke('reorder-snippets', ordered),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  deleteImage: (imagePath) => ipcRenderer.invoke('delete-image', imagePath),
  listImages: () => ipcRenderer.invoke('list-images'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  listKeyboardRawDevices: () => ipcRenderer.invoke('list-keyboard-raw-devices'),
  captureKeyboardRawSamples: (opts) => ipcRenderer.invoke('capture-keyboard-raw-samples', opts),
  keyboardPreviewStart: (devicePath) => ipcRenderer.invoke('keyboard-preview-start', devicePath),
  keyboardPreviewStop: () => ipcRenderer.invoke('keyboard-preview-stop'),
  pickAvatar: () => ipcRenderer.invoke('pick-avatar'),
  removeAvatar: () => ipcRenderer.invoke('remove-avatar'),
  exportCanneds: () => ipcRenderer.invoke('export-canneds'),
  importCanneds: () => ipcRenderer.invoke('import-canneds'),
  purgeAll: () => ipcRenderer.invoke('purge-all'),
  onDebugInfo: (callback) => {
    ipcRenderer.on('debug-info', (_event, data) => callback(data));
  },
  onOpenFaq: (callback) => {
    ipcRenderer.on('open-faq', () => callback());
  },
  onMenuExport: (callback) => {
    ipcRenderer.on('menu-export', () => callback());
  },
  onMenuImport: (callback) => {
    ipcRenderer.on('menu-import', () => callback());
  },
  onMenuPurge: (callback) => {
    ipcRenderer.on('menu-purge', () => callback());
  },
  onKeyboardPreviewKey: (callback) => {
    ipcRenderer.on('keyboard-preview-key', (_e, data) => callback(data));
  },
  onListenedKeysChanged: (callback) => {
    ipcRenderer.on('listened-keys-changed', (_e, data) => callback(data));
  },
  /** Arayüz ölçeği: 90 | 100 | 120 | 140 (yüzde). */
  setUiZoomPercent: (pct) => {
    const z = clampUiZoomPercent(pct);
    try {
      webFrame.setZoomFactor(z / 100);
    } catch {}
  },
});
