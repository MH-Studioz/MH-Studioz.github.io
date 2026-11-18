// GP 2026 - Electron main process.
// Fullscreen, hardware accelerated, unlocked frame rate.
const { app, BrowserWindow, protocol, powerSaveBlocker } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DIST_ROOT = path.join(__dirname, '..', 'dist');

// Unlocked FPS: remove Chromium's frame pacing and the 60 Hz vsync cap.
// Hardware acceleration stays enabled (we never call disableHardwareAcceleration).
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force_high_performance_gpu');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: false,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

async function serveAppFile(request) {
  try {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname || '/index.html');
    if (rel === '/' || rel === '') rel = '/index.html';
    const target = path.normalize(path.join(DIST_ROOT, rel));
    if (!target.startsWith(DIST_ROOT)) {
      return new Response('Forbidden', { status: 403 });
    }
    let stat = await fs.stat(target).catch(() => null);
    let filePath = target;
    if (stat && stat.isDirectory()) {
      filePath = path.join(target, 'index.html');
      stat = await fs.stat(filePath).catch(() => null);
    }
    if (!stat) return new Response('Not found', { status: 404 });
    const data = await fs.readFile(filePath);
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(data, {
      status: 200,
      headers: {
        'content-type': type,
        'cache-control': 'no-cache',
      },
    });
  } catch (err) {
    return new Response(`Load error: ${String(err)}`, { status: 500 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#05070b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webgl: true,
      offscreen: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadURL('app://bundle/index.html');
  }

  win.webContents.on('before-input-event', (event, input) => {
    // F11 toggles fullscreen; Esc is handled by the game (pause menu).
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  win.on('closed', () => {
    // Nothing retained.
  });
  return win;
}

app.whenReady().then(async () => {
  protocol.handle('app', serveAppFile);
  powerSaveBlocker.start('prevent-display-sleep');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
