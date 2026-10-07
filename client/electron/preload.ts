import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { Lol1v1Bridge } from '../src/shared/ipc';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Rempli au démarrage de l'interface via loadConfig() (le preload sandboxé n'a pas accès à l'environnement).
const config = { apiUrl: '', version: '' };

const bridge: Lol1v1Bridge & { loadConfig(): Promise<{ apiUrl: string; version: string }> } = {
  config,
  loadConfig: () => ipcRenderer.invoke('config'),
  lcu: {
    status: () => ipcRenderer.invoke('lcu:status'),
    pool: () => ipcRenderer.invoke('lcu:pool'),
    friends: () => ipcRenderer.invoke('lcu:friends'),
    createLobby: (puuid, name) => ipcRenderer.invoke('lcu:createLobby', puuid, name),
    startChampSelect: () => ipcRenderer.invoke('lcu:startChampSelect'),
    setSummonerSpells: (spells) => ipcRenderer.invoke('lcu:setSummonerSpells', spells),
    prepareChampSelect: (championId, spells) => ipcRenderer.invoke('lcu:prepareChampSelect', championId, spells),
    onStatus: (cb) => subscribe('lcu:status', cb),
    onGameflow: (cb) => subscribe('lcu:gameflow', cb),
    onChampSelect: (cb) => subscribe('lcu:champSelect', cb),
    onFriendsChanged: (cb) => subscribe('lcu:friendsChanged', () => cb()),
  },
  live: {
    onData: (cb) => subscribe('live:data', cb),
  },
  overlay: {
    show: (data) => ipcRenderer.invoke('overlay:show', data),
    hide: () => ipcRenderer.invoke('overlay:hide'),
  },
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
  attention: () => ipcRenderer.invoke('window:attention'),
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => subscribe('update:status', cb),
  },
};

contextBridge.exposeInMainWorld('lol1v1', bridge);
