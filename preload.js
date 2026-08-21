const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  getStatus: () => ipcRenderer.invoke("watcher:status"),
  toggle: () => ipcRenderer.invoke("watcher:toggle"),
  testToken: (payload) => ipcRenderer.invoke("watcher:test-token", payload),
  rerunRun: (payload) => ipcRenderer.invoke("watcher:rerun-run", payload),
  cancelRun: (payload) => ipcRenderer.invoke("watcher:cancel-run", payload),
  getJobs: (payload) => ipcRenderer.invoke("watcher:get-jobs", payload),
  getJobLog: (payload) => ipcRenderer.invoke("watcher:get-job-log", payload),
  dispatchWorkflow: (payload) => ipcRenderer.invoke("watcher:dispatch-workflow", payload),
  getRateLimit: () => ipcRenderer.invoke("watcher:get-rate-limit"),
  onRateLimit: (callback) => {
    const listener = (_event, rateLimit) => callback(rateLimit);
    ipcRenderer.on("watcher:rate-limit", listener);
    return () => ipcRenderer.removeListener("watcher:rate-limit", listener);
  },
  getDnd: () => ipcRenderer.invoke("dnd:get"),
  setDnd: (duration) => ipcRenderer.invoke("dnd:set", duration),
  clearDnd: () => ipcRenderer.invoke("dnd:clear"),
  onDndStatus: (callback) => {
    const listener = (_event, dndUntil) => callback(dndUntil);
    ipcRenderer.on("dnd:status", listener);
    return () => ipcRenderer.removeListener("dnd:status", listener);
  },
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
