// Génère build/icon.ico (exe, installeur, raccourcis) et public/favicon.ico depuis build/icon.svg.
// Usage : npx electron scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const sizes = [16, 24, 32, 48, 64, 128, 256];

// ICO dont chaque entrée est un PNG (accepté par Windows Vista et suivants).
function toIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html></html>');
  const out = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(${JSON.stringify(svg)});
    await img.decode();
    const out = {};
    for (const s of ${JSON.stringify([...sizes, 512])}) {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, s, s);
      out[s] = c.toDataURL('image/png').split(',')[1];
    }
    return out;
  })()`);
  const pngs = sizes.map((size) => ({ size, data: Buffer.from(out[size], 'base64') }));
  const ico = toIco(pngs);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), Buffer.from(out[512], 'base64'));
  fs.writeFileSync(path.join(root, 'public', 'favicon.ico'), ico);
  console.log('build/icon.ico, build/icon.png, public/favicon.ico');
  app.quit();
});
