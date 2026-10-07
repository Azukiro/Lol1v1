import { app, BrowserWindow, ipcMain, Notification, screen, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { OverlayData } from '../src/shared/ipc';
import { LcuConnector } from './lcu-connector';
import { LiveClientPoller } from './live-client-poller';

const isDev = !app.isPackaged;
const DEV_URL = process.env['ELECTRON_DEV_URL'] ?? 'http://localhost:4200';

/** API_URL : variable d'environnement, sinon valeur figée au build (app-config.json), sinon localhost. */
function readApiUrl(): string {
  if (process.env['API_URL']) return process.env['API_URL'];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app-config.json'), 'utf8'));
    if (cfg.apiUrl) return cfg.apiUrl;
  } catch {
    /* pas de config figée */
  }
  return 'http://localhost:5080';
}

const apiUrl = readApiUrl();
const lcu = new LcuConnector();
const live = new LiveClientPoller();
let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

function send(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0b0e14',
    title: 'LoL 1v1',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'client', 'browser', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
    overlayWindow?.close();
  });
}

/**
 * Overlay : fenêtre externe transparente, sans cadre, toujours au premier plan, qui laisse passer les clics.
 * Jamais d'injection dans le processus du jeu. Nécessite le jeu en « fenêtré sans bordure ».
 */
function showOverlay(data: OverlayData) {
  const { bounds } = screen.getPrimaryDisplay();
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setIgnoreMouseEvents(true);
  }
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'overlay.html'), 'utf8');
  void overlayWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html.replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c'))));
  overlayWindow.showInactive();
}

function hideOverlay() {
  overlayWindow?.close();
  overlayWindow = null;
}

function registerIpc() {
  ipcMain.handle('config', () => ({ apiUrl, version: app.getVersion() }));
  ipcMain.handle('lcu:status', () => lcu.status());
  ipcMain.handle('lcu:pool', () => lcu.pool());
  ipcMain.handle('lcu:createLobby', (_e, puuid: string, name: string) => lcu.createLobby(puuid, name));
  ipcMain.handle('lcu:startChampSelect', () => lcu.startChampSelect());
  ipcMain.handle('overlay:show', (_e, data: OverlayData) => showOverlay(data));
  ipcMain.handle('overlay:hide', () => hideOverlay());
  ipcMain.handle('notify', (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body, urgency: 'critical' }).show();
  });

  lcu.on('status', (s) => send('lcu:status', s));
  lcu.on('champSelect', (c) => send('lcu:champSelect', c));
  lcu.on('gameflow', (g: { phase: string }) => {
    send('lcu:gameflow', g);
    // Le poller ne tourne que pendant la partie.
    if (g.phase === 'InProgress' || g.phase === 'GameStart' || g.phase === 'Reconnect') live.start();
    else if (live.running) live.stop();
  });
  live.on('data', (d) => send('live:data', d));
}

app.setAppUserModelId('fr.lol1v1.app');
app.whenReady().then(() => {
  registerIpc();
  createMainWindow();
  lcu.start();
  if (!isDev) void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
});

app.on('window-all-closed', () => {
  lcu.stop();
  live.stop();
  app.quit();
});
