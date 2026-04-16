const path = require('path');
const fs = require('fs');

async function main() {
  const { createWindowsInstaller } = require('electron-winstaller');

  const root = path.resolve(__dirname, '..');
  const appDir = path.join(root, 'dist', 'ZezeCanned-win32-x64');
  const outDir = path.join(root, 'dist-installer-squirrel');
  const setupIcon = path.join(root, 'build', 'icon.ico');

  if (!fs.existsSync(appDir)) {
    throw new Error(`Önce build alın: ${appDir} bulunamadı. 'npm run build' çalıştırın.`);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const opts = {
    appDirectory: appDir,
    outputDirectory: outDir,
    authors: 'Zeze',
    title: 'ZezeCanned Kurulum',
    description: 'ZezeCanned metin otomasyon uygulamasi kurulumu',
    name: 'ZezeCanned',
    exe: 'ZezeCanned.exe',
    setupExe: 'ZezeCannedSetup.exe',
    noMsi: true,
    noDelta: true,
  };

  if (fs.existsSync(setupIcon)) {
    opts.setupIcon = setupIcon;
  }

  await createWindowsInstaller(opts);

  console.log(`OK: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

