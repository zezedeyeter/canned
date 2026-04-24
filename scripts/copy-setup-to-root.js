const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const from = path.join(root, 'dist-installer-squirrel', 'ZezeCannedSetup.exe');
const to = path.join(root, 'ZezeCannedSetup.exe');

if (!fs.existsSync(from)) {
  console.error('[copy-setup-to-root] Kurulum dosyasi bulunamadi:', from);
  process.exit(1);
}

fs.copyFileSync(from, to);
console.log('[copy-setup-to-root] Hazir:', to);
