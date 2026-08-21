const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  getStatus: () => ipcRenderer.invoke("watcher:status"),
  toggle: () => ipcRenderer.invoke("watcher:toggle"),
  testToken: (payload) => ipcRenderer.invoke("watcher:test-token", payload),
  rerunRun: (payload) => ipcRenderer.invoke("watcher:rerun-run", payload),
  getSummaries: () => ipcRenderer.invoke("watcher:get-summaries"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  onSummaries: (callback) => {
    const listener = (_event, summaries) => callback(summaries);
    ipcRenderer.on("watcher:summaries", listener);
    return () => ipcRenderer.removeListener("watcher:summaries", listener);
  },
  onStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("watcher:status-changed", listener);
    return () => ipcRenderer.removeListener("watcher:status-changed", listener);
  },
  getUpdateStatus: () => ipcRenderer.invoke("update:get-status"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
  onUpdateInstalling: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("update:installing", listener);
    return () => ipcRenderer.removeListener("update:installing", listener);
  },
  getVersion: () => ipcRenderer.invoke("app:get-version"),
});
