const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voiceBridge", {
  wireClientAudio: (inputMode) => ipcRenderer.invoke("voiceBridge:wireClientAudio", inputMode),
  clientAudioStatus: () => ipcRenderer.invoke("voiceBridge:clientAudioStatus"),
  stopSpeech: () => ipcRenderer.invoke("voiceBridge:stopSpeech"),
  chooseClientWorkspace: () => ipcRenderer.invoke("voiceBridge:chooseClientWorkspace"),
  openPath: (filePath) => ipcRenderer.invoke("voiceBridge:openPath", filePath),
  reportReady: () => ipcRenderer.send("voiceBridge:rendererReady"),
});