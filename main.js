const { app, BrowserWindow, session } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 950,
    minHeight: 700,
    title: 'Gemini Live PC',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    }
  });

  win.loadFile('index.html');

  // Uncomment to debug
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  // Automatically grant permission requests for microphone (media) and speech recognition
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'media' || permission === 'speech-recognition') {
      return true;
    }
    return false;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'media' || permission === 'speech-recognition') {
      callback(true);
    } else {
      callback(false);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
