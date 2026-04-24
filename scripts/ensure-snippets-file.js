const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const p = path.join(root, 'snippets.json');

if (!fs.existsSync(p)) {
  fs.writeFileSync(p, '[]\n', 'utf8');
  console.log('[ensure-snippets-file] snippets.json olusturuldu.');
}
