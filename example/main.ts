import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";

import { createIpcContainer } from "electron-ipc-module";
import { createGreetingIpc } from "./ipc/greeting.ipc.js";

const ipc = createIpcContainer();

async function createWindow() {
  await ipc.load("greeting", createGreetingIpc());

  const window = new BrowserWindow({
    width: 640,
    height: 420,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("./preload.js", import.meta.url)),
    },
  });

  await window.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => {
  void ipc.dispose();
});
