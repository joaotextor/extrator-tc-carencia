const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { createWorker } = require("tesseract.js");

let originalWidth;

ipcMain.on("toggle-debug", (event, isDebugMode) => {
  const win = BrowserWindow.getFocusedWindow();

  if (isDebugMode) {
    originalWidth = win.getSize()[0];
    win.setSize(originalWidth + 500, win.getSize()[1]);
    win.webContents.openDevTools({ mode: "right" });
  } else {
    win.setSize(originalWidth, win.getSize()[1]);
    win.webContents.closeDevTools();
  }
});

function createWindow() {
  const win = new BrowserWindow({
    // width: 1024,
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.setMenu(null);
  // win.webContents.openDevTools();
  win.loadFile("src/renderer/index.html");
}

let worker = null;

async function getWorker() {
  if (!worker) {
    worker = await createWorker("por");
  }
  return worker;
}

ipcMain.handle("process-ocr", async (event, imagePath) => {
  const w = await getWorker();
  const {
    data: { text },
  } = await w.recognize(imagePath);
  return text;
});

// Add cleanup when app closes
app.on("before-quit", async () => {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
});

ipcMain.handle("cleanup-ocr", async () => {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
});

ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "PDF Files", extensions: ["pdf"] }],
  });
  return result;
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
