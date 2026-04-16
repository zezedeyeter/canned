const { app, BrowserWindow, ipcMain, clipboard, nativeImage, dialog, Menu } = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function handleSquirrelEvent() {
  if (process.platform !== 'win32') return false;
  if (process.argv.length < 2) return false;

  const squirrelEvent = process.argv[1];
  const exeName = path.basename(process.execPath);
  const updateExe = path.resolve(process.execPath, '..', '..', 'Update.exe');

  const spawnUpdate = (args) => {
    try {
      spawn(updateExe, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch {}
  };

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Create start menu + desktop shortcuts and exit without opening app UI.
      spawnUpdate(['--createShortcut', exeName]);
      setTimeout(() => app.quit(), 1000);
      return true;
    case '--squirrel-uninstall':
      spawnUpdate(['--removeShortcut', exeName]);
      setTimeout(() => app.quit(), 1000);
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
    default:
      return false;
  }
}

const isSquirrelEvent = handleSquirrelEvent();

function log(...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}]`, ...args);
}

function getImagesDir() {
  return path.join(app.getPath('userData'), 'images');
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  const p = getSettingsPath();
  try {
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return {
        profileName: typeof parsed.profileName === 'string' ? parsed.profileName : 'Zeze%Canned',
        theme: typeof parsed.theme === 'string' ? parsed.theme : 'mevcut',
        avatarPath: typeof parsed.avatarPath === 'string' ? parsed.avatarPath : '',
      };
    }
  } catch (e) {
    log('Settings okunamadı:', e.message);
  }
  return { profileName: 'Zeze%Canned', theme: 'mevcut', avatarPath: '' };
}

function saveSettings(next) {
  const p = getSettingsPath();
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8');
  } catch (e) {
    log('Settings yazılamadı:', e.message);
  }
}

function showFirstRunDataInfo() {
  const marker = path.join(app.getPath('userData'), '.first-run-shown');
  if (fs.existsSync(marker)) return;

  const dataPath = app.getPath('userData');
  dialog.showMessageBox({
    type: 'info',
    title: 'Zeze%Canned - Veri Konumu',
    message: 'Verileriniz bu klasörde saklanır',
    detail: `${dataPath}\n\nBu klasörde canned kayıtları, ayarlar ve görseller tutulur.`,
    buttons: ['Tamam'],
  }).finally(() => {
    try { fs.writeFileSync(marker, 'shown', 'utf-8'); } catch {}
  });
}

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.ico'),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function getBundledDefaultProfilePath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'default-profile.jpg'),
    path.join(__dirname, 'build', 'default-profile.jpg'),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function ensureDefaultProfileImage() {
  if (settings.avatarPath && fs.existsSync(settings.avatarPath)) return;
  const bundled = getBundledDefaultProfilePath();
  if (!bundled) return;
  try {
    const dest = path.join(app.getPath('userData'), 'avatar.jpg');
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.copyFileSync(bundled, dest);
    settings.avatarPath = dest;
    saveSettings(settings);
  } catch {}
}

// ── Data ────────────────────────────────────────────────────────────────────
function getSnippetsPath() {
  const userDataDir = app.getPath('userData');
  const target = path.join(userDataDir, 'snippets.json');
  if (!fs.existsSync(target)) {
    const bundled = path.join(process.resourcesPath, 'snippets.json');
    const local = path.join(__dirname, 'snippets.json');
    const source = fs.existsSync(bundled) ? bundled : fs.existsSync(local) ? local : null;
    if (source) {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
  return target;
}

let SNIPPETS_FILE = '';
let mainWindow = null;
let buffer = '';
let isReplacing = false;
let snippets = [];
let osKeymap = null;
let psWorker = null;
let settings = { profileName: 'Zeze%Canned', theme: 'mevcut', avatarPath: '' };

function loadSnippets() {
  try {
    if (fs.existsSync(SNIPPETS_FILE)) {
      return JSON.parse(fs.readFileSync(SNIPPETS_FILE, 'utf-8'));
    }
  } catch (e) { log('Snippet okunamadı:', e.message); }
  return [];
}

function saveSnippets(data) {
  fs.writeFileSync(SNIPPETS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setHelpOnlyMenu() {
  const template = [
    {
      label: 'Help',
      submenu: [
        {
          label: 'SSS',
          click: () => sendToRenderer('open-faq', {}),
        },
        { type: 'separator' },
        {
          label: 'Export (Canned)',
          click: () => sendToRenderer('menu-export', {}),
        },
        {
          label: 'Import (Canned)',
          click: () => sendToRenderer('menu-import', {}),
        },
        { type: 'separator' },
        {
          label: 'Uygulamayı kalıcı kaldır (veriler dahil)',
          click: () => sendToRenderer('menu-purge', {}),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── OS Keyboard Layout (Turkish Q, US, etc.) ────────────────────────────────
function initKeymapFromOS() {
  return new Promise((resolve) => {
    const script = `
Add-Type -MemberDefinition @'
[DllImport("user32.dll", CharSet=CharSet.Unicode)]
public static extern uint MapVirtualKey(uint uCode, uint uMapType);
[DllImport("user32.dll", CharSet=CharSet.Unicode)]
public static extern int ToUnicode(uint wVirtKey, uint wScanCode, byte[] lpKeyState,
  [Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pwszBuff, int cchBuff, uint wFlags);
'@ -Name W -Namespace K
$r=@{}
for($s=1;$s -lt 100;$s++){
  $v=[K.W]::MapVirtualKey([uint32]$s,3)
  if($v -eq 0){continue}
  $k=New-Object byte[] 256
  $b=New-Object System.Text.StringBuilder 5
  $x=[K.W]::ToUnicode($v,$s,$k,$b,5,0)
  if($x -lt 0){[void][K.W]::ToUnicode($v,$s,$k,(New-Object System.Text.StringBuilder 5),5,0);continue}
  $n=if($x -gt 0){$b.ToString(0,$x)}else{''}
  $k2=New-Object byte[] 256;$k2[0x10]=0x80
  $b2=New-Object System.Text.StringBuilder 5
  $x2=[K.W]::ToUnicode($v,$s,$k2,$b2,5,0)
  if($x2 -lt 0){[void][K.W]::ToUnicode($v,$s,$k2,(New-Object System.Text.StringBuilder 5),5,0)}
  $sh=if($x2 -gt 0){$b2.ToString(0,$x2)}else{''}
  $k3=New-Object byte[] 256;$k3[0x11]=0x80;$k3[0x12]=0x80
  $b3=New-Object System.Text.StringBuilder 5
  $x3=[K.W]::ToUnicode($v,$s,$k3,$b3,5,0)
  if($x3 -lt 0){[void][K.W]::ToUnicode($v,$s,$k3,(New-Object System.Text.StringBuilder 5),5,0)}
  $ag=if($x3 -gt 0){$b3.ToString(0,$x3)}else{''}
  if($n -ne '' -or $sh -ne '' -or $ag -ne ''){$r["$s"]=@{n=$n;s=$sh;a=$ag}}
}
ConvertTo-Json $r -Compress`;
    execFile('powershell.exe',
      ['-NoProfile', '-NoLogo', '-NonInteractive', '-Command', script],
      { encoding: 'utf-8', windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) { log('Keymap hatası:', err.message); resolve(null); return; }
        try {
          const parsed = JSON.parse(stdout.trim());
          log('OS keymap yüklendi:', Object.keys(parsed).length, 'tuş');
          resolve(parsed);
        } catch { resolve(null); }
      });
  });
}

function buildUSFallback() {
  const m = {};
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (UiohookKey[c] !== undefined) m[String(UiohookKey[c])] = { n: c.toLowerCase(), s: c.toUpperCase() };
  }
  for (let i = 0; i <= 9; i++) {
    const k = UiohookKey[String(i)];
    if (k !== undefined) m[String(k)] = { n: String(i), s: '!@#$%^&*()'[i] };
  }
  const s = { Space: [' ',' '], Slash: ['/','?'], Period: ['.','>'], Comma: [',','<'], Minus: ['-','_'] };
  for (const [nm, [n, sh]] of Object.entries(s)) {
    if (UiohookKey[nm] !== undefined) m[String(UiohookKey[nm])] = { n, s: sh };
  }
  return m;
}

// ── PowerShell worker ───────────────────────────────────────────────────────
function startPSWorker() {
  psWorker = spawn('powershell.exe',
    ['-NoProfile', '-NoLogo', '-NonInteractive', '-Command', '-'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  psWorker.on('error', (e) => log('PS hata:', e.message));
  psWorker.on('exit', () => { psWorker = null; });
  psWorker.stdin.write('Add-Type -AssemblyName System.Windows.Forms\n');
  psWorker.stdin.write('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n');
  log('PS worker hazır.');
}

function sendPS(cmd) {
  return new Promise((resolve) => {
    if (!psWorker || !psWorker.stdin.writable) startPSWorker();
    const marker = `__OK_${Date.now()}__`;
    let buf = '';
    const fn = (d) => { buf += d.toString(); if (buf.includes(marker)) { psWorker.stdout.removeListener('data', fn); resolve(); } };
    psWorker.stdout.on('data', fn);
    psWorker.stdin.write(`${cmd}\nWrite-Output '${marker}'\n`);
    setTimeout(() => { psWorker.stdout.removeListener('data', fn); resolve(); }, 4000);
  });
}

// ── Trigger detection & replacement ─────────────────────────────────────────
function checkTriggers() {
  const sorted = [...snippets].sort((a, b) => b.trigger.length - a.trigger.length);
  for (const sn of sorted) {
    if (buffer.endsWith(sn.trigger)) {
      log('TRIGGER:', sn.trigger, '→ replacement başlıyor');
      performReplacement(sn);
      return;
    }
  }
}

async function pasteCtrlV() {
  uIOhook.keyToggle(UiohookKey.Ctrl, 'down');
  await sleep(20);
  uIOhook.keyTap(UiohookKey.V);
  await sleep(20);
  uIOhook.keyToggle(UiohookKey.Ctrl, 'up');
  await sleep(50);
}

async function performReplacement(snippet) {
  const { trigger, text, imagePath } = snippet;
  isReplacing = true;
  sendDebug('replacing', `"${trigger}" → yapıştırılıyor...`);

  try {
    const savedText = clipboard.readText();
    const savedImage = clipboard.readImage();

    // Release ALL modifier keys (AltGr ghost fix)
    for (const k of [UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Shift, UiohookKey.ShiftRight]) {
      uIOhook.keyToggle(k, 'up');
    }
    await sleep(60);

    // Delete trigger text with backspaces
    const bs = trigger.length;
    log(`  ${bs} BS gönderiliyor...`);
    for (let i = 0; i < bs; i++) {
      uIOhook.keyTap(UiohookKey.Backspace);
      await sleep(15);
    }
    await sleep(30);

    // 1) Paste text first
    if (text) {
      log('  Metin yapıştırılıyor...');
      clipboard.writeText(text);
      await sleep(50);
      await pasteCtrlV();
    }

    // 2) Then paste image below the text
    if (imagePath && fs.existsSync(imagePath)) {
      log('  Görsel yapıştırılıyor:', imagePath);
      const img = nativeImage.createFromPath(imagePath);
      if (!img.isEmpty()) {
        await sleep(80);
        clipboard.writeImage(img);
        await sleep(50);
        await pasteCtrlV();
      }
    }

    log('  Replacement tamamlandı.');
    await sleep(300);

    // Restore original clipboard
    if (!savedImage.isEmpty()) clipboard.writeImage(savedImage);
    else clipboard.writeText(savedText || '');

    sendDebug('done', `"${trigger}" → başarılı`);
  } catch (err) {
    log('  Replacement hatası:', err.message);
    sendDebug('error', err.message);
  }

  buffer = '';
  isReplacing = false;
}

// ── Debug IPC ───────────────────────────────────────────────────────────────
function sendDebug(type, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('debug-info', { type, buffer, detail, time: Date.now() });
  }
}

// ── Keyboard hook ───────────────────────────────────────────────────────────
function startKeyboardHook() {
  const IGNORE = new Set([
    UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Ctrl, UiohookKey.CtrlRight,
    UiohookKey.Alt, UiohookKey.AltRight,
    UiohookKey.Meta, UiohookKey.MetaRight,
    UiohookKey.CapsLock, UiohookKey.NumLock,
  ]);

  // Track physical AltGr state to avoid "ghost" AltGr on subsequent keys
  let altGrPhysicallyDown = false;

  uIOhook.on('keydown', (e) => {
    if (e.keycode === UiohookKey.AltRight) altGrPhysicallyDown = true;
    if (isReplacing) return;
    if (mainWindow && mainWindow.isFocused()) return;
    if (IGNORE.has(e.keycode)) return;

    if (e.keycode === UiohookKey.Backspace) {
      buffer = buffer.slice(0, -1);
      sendDebug('key', `BS → buffer='${buffer}'`);
      return;
    }
    if ([UiohookKey.Enter, UiohookKey.Escape, UiohookKey.Tab].includes(e.keycode)) {
      buffer = '';
      return;
    }

    // Numpad keys → map directly to digits
    const NUMPAD = {
      [UiohookKey.Numpad0]: '0', [UiohookKey.Numpad1]: '1', [UiohookKey.Numpad2]: '2',
      [UiohookKey.Numpad3]: '3', [UiohookKey.Numpad4]: '4', [UiohookKey.Numpad5]: '5',
      [UiohookKey.Numpad6]: '6', [UiohookKey.Numpad7]: '7', [UiohookKey.Numpad8]: '8',
      [UiohookKey.Numpad9]: '9', [UiohookKey.NumpadDecimal]: '.', [UiohookKey.NumpadAdd]: '+',
      [UiohookKey.NumpadSubtract]: '-', [UiohookKey.NumpadMultiply]: '*', [UiohookKey.NumpadDivide]: '/',
    };

    let char;
    if (NUMPAD[e.keycode]) {
      char = NUMPAD[e.keycode];
    } else {
      const entry = osKeymap[String(e.keycode)];
      if (!entry) return;
      if (altGrPhysicallyDown && entry.a) char = entry.a;
      else if (e.shiftKey) char = entry.s || entry.n;
      else char = entry.n;
    }
    if (!char || char.length !== 1 || char.charCodeAt(0) < 32) return;

    buffer += char;
    if (buffer.length > 200) buffer = buffer.slice(-100);

    log(`KEY sc=${e.keycode} shift=${e.shiftKey} → '${char}'  buffer='${buffer.slice(-20)}'`);
    sendDebug('char', `'${char}' → buffer='${buffer.slice(-30)}'`);
    checkTriggers();
  });

  uIOhook.on('keyup', (e) => {
    if (e.keycode === UiohookKey.AltRight) altGrPhysicallyDown = false;
  });

  uIOhook.start();
  log('Hook başladı. Snippets:', snippets.map(s => s.trigger).join(', '));
}

// ── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 920, height: 700, minWidth: 620, minHeight: 420,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
    title: 'Zeze%Canned', show: false,
    autoHideMenuBar: false,
    ...(iconPath ? { icon: iconPath } : {}),
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('get-snippets', () => snippets);

ipcMain.handle('add-snippet', (_, s) => {
  s.id = Date.now().toString();
  s.category = s.category || 'Genel';
  snippets.push(s);
  saveSnippets(snippets);
  return snippets;
});

ipcMain.handle('update-snippet', (_, u) => {
  const i = snippets.findIndex(s => s.id === u.id);
  if (i !== -1) {
    snippets[i] = { ...snippets[i], ...u };
    saveSnippets(snippets);
  }
  return snippets;
});

ipcMain.handle('delete-snippet', (_, id) => {
  snippets = snippets.filter(s => s.id !== id);
  saveSnippets(snippets);
  return snippets;
});

ipcMain.handle('reorder-snippets', (_, ordered) => {
  snippets = ordered;
  saveSnippets(snippets);
  return snippets;
});

ipcMain.handle('pick-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Görsel Seç',
    filters: [{ name: 'Görseller', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const srcPath = result.filePaths[0];
  const imgDir = getImagesDir();
  fs.mkdirSync(imgDir, { recursive: true });
  const ext = path.extname(srcPath) || '.png';
  const dest = path.join(imgDir, `${Date.now()}${ext}`);
  fs.copyFileSync(srcPath, dest);
  log('Görsel kaydedildi:', dest);
  return dest;
});

ipcMain.handle('delete-image', (_, imgPath) => {
  try { if (imgPath && fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch {}
  return true;
});

ipcMain.handle('list-images', () => {
  const imgDir = getImagesDir();
  try {
    if (!fs.existsSync(imgDir)) return [];
    return fs.readdirSync(imgDir)
      .filter((n) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(n))
      .map((n) => path.join(imgDir, n))
      .sort((a, b) => {
        try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
      });
  } catch {
    return [];
  }
});

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('set-settings', (_, patch) => {
  const allowedThemes = new Set(['mevcut', 'beyaz', 'pembe', 'mor', 'siyah']);
  const next = { ...settings };

  if (patch && typeof patch === 'object') {
    if (typeof patch.profileName === 'string') next.profileName = patch.profileName.trim().slice(0, 40) || 'Zeze%Canned';
    if (typeof patch.theme === 'string' && allowedThemes.has(patch.theme)) next.theme = patch.theme;
    if (typeof patch.avatarPath === 'string') next.avatarPath = patch.avatarPath;
  }

  settings = next;
  saveSettings(settings);
  return settings;
});

function getAvatarDestPath(srcPath) {
  const ext = (path.extname(srcPath) || '').toLowerCase();
  const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext) ? ext : '.png';
  return path.join(app.getPath('userData'), `avatar${safeExt}`);
}

ipcMain.handle('pick-avatar', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Profil Resmi Seç',
    filters: [{ name: 'Görseller', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  const srcPath = result.filePaths[0];
  const dest = getAvatarDestPath(srcPath);

  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    // clear previous avatar variants
    for (const e of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']) {
      const p = path.join(app.getPath('userData'), `avatar${e}`);
      try { if (fs.existsSync(p) && p !== dest) fs.unlinkSync(p); } catch {}
    }
    fs.copyFileSync(srcPath, dest);
    settings.avatarPath = dest;
    saveSettings(settings);
    return { ok: true, avatarPath: dest };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle('remove-avatar', () => {
  try {
    for (const e of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']) {
      const p = path.join(app.getPath('userData'), `avatar${e}`);
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
  } catch {}
  settings.avatarPath = '';
  saveSettings(settings);
  return { ok: true };
});

function guessMime(filePath) {
  const ext = (path.extname(filePath) || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

ipcMain.handle('export-canneds', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Canned Export',
    defaultPath: 'zeze-canned-export.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' };

  const canneds = snippets.map((s) => {
    let image = null;
    if (s.imagePath && fs.existsSync(s.imagePath)) {
      try {
        const buf = fs.readFileSync(s.imagePath);
        image = {
          name: path.basename(s.imagePath),
          mime: guessMime(s.imagePath),
          dataBase64: buf.toString('base64'),
        };
      } catch {
        image = null;
      }
    }
    return {
      trigger: s.trigger,
      category: s.category || 'Genel',
      text: s.text || '',
      image,
    };
  });

  const payload = {
    app: 'Zeze%Canned',
    version: 1,
    exportedAt: new Date().toISOString(),
    canneds,
  };
  fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return { ok: true, filePath: res.filePath, count: canneds.length };
});

ipcMain.handle('import-canneds', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Canned Import',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, reason: 'canceled' };

  const filePath = res.filePaths[0];
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed?.canneds) ? parsed.canneds : [];

  const imgDir = getImagesDir();
  fs.mkdirSync(imgDir, { recursive: true });

  let imported = 0;
  let skipped = 0;
  for (const c of list) {
    const trigger = String(c.trigger || '').trim();
    if (!trigger) { skipped++; continue; }
    if (snippets.some((s) => s.trigger === trigger)) { skipped++; continue; }

    let imagePath = '';
    if (c.image && c.image.dataBase64) {
      try {
        const mime = c.image.mime || 'image/png';
        const ext = mime.includes('jpeg') ? '.jpg' :
          mime.includes('gif') ? '.gif' :
          mime.includes('webp') ? '.webp' :
          mime.includes('bmp') ? '.bmp' : '.png';
        const dest = path.join(imgDir, `${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
        fs.writeFileSync(dest, Buffer.from(c.image.dataBase64, 'base64'));
        imagePath = dest;
      } catch {
        imagePath = '';
      }
    }

    const newItem = {
      id: Date.now().toString() + Math.random().toString(16).slice(2),
      trigger,
      category: String(c.category || 'Genel'),
      text: String(c.text || ''),
      imagePath,
    };
    snippets.push(newItem);
    imported++;
  }

  saveSnippets(snippets);
  return { ok: true, imported, skipped, total: list.length };
});

ipcMain.handle('purge-all', async () => {
  const confirm = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['İptal', 'Kalıcı kaldır'],
    defaultId: 0,
    cancelId: 0,
    title: 'Zeze%Canned',
    message: 'Tüm veriler (canned listesi ve görseller) kalıcı olarak silinecek. Devam edilsin mi?',
    detail: `Silinecek klasör: ${app.getPath('userData')}`,
  });
  if (confirm.response !== 1) return { ok: false, reason: 'canceled' };

  try {
    const userData = app.getPath('userData');
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {}

  // If this is a Squirrel.Windows install, also trigger uninstall so app disappears.
  try {
    const updateExe = path.resolve(process.execPath, '..', '..', 'Update.exe');
    if (fs.existsSync(updateExe)) {
      spawn(updateExe, ['--uninstall'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    }
  } catch {}

  // Quit immediately after purge/uninstall trigger
  setTimeout(() => {
    try { app.quit(); } catch {}
  }, 80);

  return { ok: true };
});

// ── App lifecycle ───────────────────────────────────────────────────────────
app.commandLine.appendSwitch('disable-gpu-cache');

if (!isSquirrelEvent) app.whenReady().then(async () => {
  SNIPPETS_FILE = getSnippetsPath();
  snippets = loadSnippets();
  log('Snippets yüklendi:', snippets.length, 'adet');

  settings = loadSettings();
  ensureDefaultProfileImage();

  osKeymap = await initKeymapFromOS();
  if (!osKeymap) { osKeymap = buildUSFallback(); log('US fallback kullanılıyor.'); }

  createWindow();
  setHelpOnlyMenu();
  startPSWorker();
  startKeyboardHook();
  showFirstRunDataInfo();
});

app.on('before-quit', () => {
  try { uIOhook.stop(); } catch {}
  try { if (psWorker) psWorker.kill(); } catch {}
});

app.on('window-all-closed', () => app.quit());
