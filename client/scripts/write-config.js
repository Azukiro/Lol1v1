// Fige API_URL dans dist-electron/app-config.json au moment du build.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'dist-electron', 'app-config.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ apiUrl: process.env.API_URL || 'http://localhost:5080' }, null, 2));
console.log('app-config.json →', process.env.API_URL || 'http://localhost:5080');
