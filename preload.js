const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bobDesktop", {
  openFile: () => ipcRenderer.invoke("file:open"),
  saveFile: (data) => ipcRenderer.invoke("file:save", data),
  analyzeWithBob: (code) => ipcRenderer.invoke("bob:analyze", code),
  executeCommand: (data) => ipcRenderer.invoke("terminal:execute", data)
});