const { contextBridge, ipcRenderer } = require('electron');

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
});
