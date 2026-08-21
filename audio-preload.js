const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("audioAPI", {
  onPlay: (callback) => {
    ipcRenderer.on("audio:play", (_event, kind) => callback(kind));
  },
});
