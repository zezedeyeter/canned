const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const jpgPath = path.join(root, 'profile.jpg');
const icoPath = path.join(buildDir, 'icon.ico');

fs.mkdirSync(buildDir, { recursive: true });

if (!fs.existsSync(jpgPath)) {
  if (fs.existsSync(icoPath)) {
    console.log('[ensure-app-icon] profile.jpg yok, mevcut build/icon.ico korunuyor.');
    process.exit(0);
  }
  console.error('[ensure-app-icon] profile.jpg yok ve build/icon.ico bulunamadi.');
  process.exit(1);
}

const psScript = [
  'Add-Type -AssemblyName System.Drawing',
  `$src = '${jpgPath.replace(/'/g, "''")}'`,
  `$dst = '${icoPath.replace(/'/g, "''")}'`,
  '$img = [System.Drawing.Image]::FromFile($src)',
  '$bmp = New-Object System.Drawing.Bitmap 256, 256',
  '$g = [System.Drawing.Graphics]::FromImage($bmp)',
  '$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality',
  '$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
  '$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
  '$g.DrawImage($img, 0, 0, 256, 256)',
  '$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())',
  '$fs = [System.IO.File]::Open($dst, [System.IO.FileMode]::Create)',
  '$icon.Save($fs)',
  '$fs.Close()',
  '$g.Dispose()',
  '$bmp.Dispose()',
  '$img.Dispose()',
].join('; ');

const res = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
  { stdio: 'inherit', windowsHide: true },
);

if (res.error) {
  console.error('[ensure-app-icon] PowerShell calismadi:', res.error.message || res.error);
  process.exit(1);
}
if (res.status !== 0) process.exit(res.status || 1);

console.log('[ensure-app-icon] profile.jpg -> build/icon.ico');
