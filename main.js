const { app, BrowserWindow, ipcMain, clipboard, nativeImage, dialog, Menu } = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

/**
 * Windows: Electron kapandıktan sonra klasörleri sil.
 * Gorunur .bat/cmd penceresi acmamak icin gizli PowerShell ile tekrarlı silme yapar.
 */
function scheduleWindowsPurgeDeferredDeletes(targetPaths) {
  if (process.platform !== 'win32' || !targetPaths || !targetPaths.length) return [];
  const logPath = path.join(os.tmpdir(), 'ZezeCanned-deferred-delete.log');
  const uniq = [...new Set(targetPaths.map((p) => path.resolve(String(p))).filter(Boolean))];
  if (!uniq.length) return [];

  try {
    const payload = {
      logPath,
      paths: uniq,
      startedAt: new Date().toISOString(),
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const ps = [
      '$ErrorActionPreference = "SilentlyContinue"',
      `$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${json}')) | ConvertFrom-Json`,
      '$log = [string]$payload.logPath',
      '$paths = @($payload.paths)',
      'function W([string]$m){ Add-Content -LiteralPath $log -Value ((Get-Date -Format o) + " " + $m) -Encoding UTF8 }',
      'W "--- deferred-purge-start ---"',
      'Start-Sleep -Seconds 18',
      'foreach($p in $paths){',
      '  if(-not (Test-Path -LiteralPath $p)){ W("skip-not-found " + $p); continue }',
      '  $ok=$false',
      '  for($i=0; $i -lt 36; $i++){',
      '    try{ Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop } catch {}',
      '    if(-not (Test-Path -LiteralPath $p)){ $ok=$true; break }',
      '    Start-Sleep -Seconds 2',
      '  }',
      '  if($ok){ W("removed " + $p) } else { W("still-exists " + $p) }',
      '}',
      'W "--- deferred-purge-end ---"',
    ].join('; ');

    spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-Command',
      ps,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    try {
      fs.appendFileSync(
        logPath,
        `${new Date().toISOString()} ana-surec: deferred purge powershell tetiklendi\n`,
        'utf8',
      );
    } catch {}
    log('Ertelenen purge: hidden powershell tetiklendi');
    return uniq;
  } catch (e) {
    log('scheduleWindowsPurgeDeferredDeletes:', e && e.message ? e.message : e);
    return [];
  }
}

/** Purge oncesi userData kilidini azalt: hook / alt surec (pencereyi destroy etme — IPC cevabi kesilir). */
function releaseResourcesForPurge() {
  try { uIOhook.stop(); } catch {}
  try { if (psWorker) psWorker.kill(); } catch {}
  stopKeyboardPreview();
  stopRawKeyboardListen();
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.closeDevTools(); } catch {}
    }
  } catch {}
}

function isWindowsUserProfileAppDataPath(p) {
  if (process.platform !== 'win32' || !p) return false;
  try {
    const home = os.homedir();
    if (!home) return false;
    const norm = path.resolve(p);
    const low = norm.toLowerCase();
    const h = home.toLowerCase();
    if (!low.startsWith(h)) return false;
    return low.includes(`${path.sep}appdata${path.sep}`);
  } catch {
    return false;
  }
}

function getImagesDir() {
  return path.join(app.getPath('userData'), 'images');
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getRawKbScriptPath() {
  const bundled = path.join(process.resourcesPath || '', 'raw-keyboard-helper.ps1');
  if (bundled && fs.existsSync(bundled)) return bundled;
  return path.join(__dirname, 'scripts', 'raw-keyboard-helper.ps1');
}

function hidDeviceLabel(devicePath) {
  const p = String(devicePath || '');
  const m = p.match(/VID_([0-9A-Fa-f]+).*PID_([0-9A-Fa-f]+)/i);
  const mi = p.match(/MI_([0-9A-Fa-f]+)/i);
  const col = p.match(/Col(\d+)/i);
  const parts = [];
  if (m) parts.push(`VID_${m[1].toUpperCase()} · PID_${m[2].toUpperCase()}`);
  if (mi) parts.push(`MI_${mi[1].toUpperCase()}`);
  if (col) parts.push(`Col${col[1]}`);
  if (parts.length) return parts.join(' · ');
  const short = p.length > 72 ? `${p.slice(0, 32)}…${p.slice(-28)}` : p;
  return short || 'Klavye';
}

function normalizeWindowsInstanceId(v) {
  return String(v || '').replace(/\//g, '\\').trim().toUpperCase();
}

function hidPathToInstanceId(devicePath) {
  const p = String(devicePath || '').trim();
  if (!p) return '';
  // \\?\HID#VID_046D&PID_C33C&MI_00#8&...&0000#{GUID}
  // -> HID\VID_046D&PID_C33C&MI_00\8&...&0000
  const m = p.match(/^\\\\\?\\([^#]+)#([^#]+)#([^#]+)(?:#\{.*)?$/i);
  if (!m) return '';
  return normalizeWindowsInstanceId(`${m[1]}\\${m[2]}\\${m[3]}`);
}

function isGenericKeyboardName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  return /^(HID Keyboard Device|HID Klavye Aygıtı|USB Input Device|Standard PS\/2 Keyboard)$/i.test(n);
}

function pickBestKeyboardName(row) {
  if (!row || typeof row !== 'object') return '';
  const candidates = [
    row.BusReportedDeviceDesc,
    row.ParentFriendlyName,
    row.FriendlyName,
  ].map((x) => String(x || '').trim()).filter(Boolean);
  const nonGeneric = candidates.find((x) => !isGenericKeyboardName(x));
  return nonGeneric || candidates[0] || '';
}

/** HID yolundan VID/PID (Windows biçimi). */
function extractVidPidFromHidPath(devicePath) {
  const m = String(devicePath || '').match(/VID_([0-9A-Fa-f]+).*PID_([0-9A-Fa-f]+)/i);
  if (!m) return null;
  return { vid: m[1].toUpperCase(), pid: m[2].toUpperCase() };
}

/** PnP klavye listesi → InstanceId içinde VID/PID eşleşmesiyle okunur ad. */
function loadPnpKeyboardFriendlyRows() {
  return new Promise((resolve) => {
    const cmd = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$devs = @(Get-PnpDevice -PresentOnly | Where-Object { $_.Status -eq "OK" -and ($_.Class -eq "Keyboard" -or $_.Class -eq "HIDClass") })',
      '$rows = @()',
      'foreach ($d in $devs) {',
      '  $bus = ""; $parent = ""; $parentName = ""',
      '  try { $bus = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName "DEVPKEY_Device_BusReportedDeviceDesc" -ErrorAction Stop).Data } catch {}',
      '  try { $parent = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName "DEVPKEY_Device_Parent" -ErrorAction Stop).Data } catch {}',
      '  if ($parent) { try { $parentName = (Get-PnpDevice -InstanceId $parent -ErrorAction Stop).FriendlyName } catch {} }',
      '  $rows += [PSCustomObject]@{ InstanceId=$d.InstanceId; FriendlyName=$d.FriendlyName; BusReportedDeviceDesc=$bus; ParentFriendlyName=$parentName; ParentInstanceId=$parent; Class=$d.Class }',
      '}',
      'if (@($rows).Count -eq 0) { Write-Output "[]" } else { $rows | ConvertTo-Json -Depth 4 -Compress }',
    ].join('; ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      { encoding: 'utf8', timeout: 22000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        try {
          const t = String(stdout).replace(/^\uFEFF/, '').trim();
          const j = JSON.parse(t);
          const arr = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : [];
          resolve(arr.filter((x) => x && (x.InstanceId || x.FriendlyName)));
        } catch {
          resolve([]);
        }
      },
    );
  });
}

function friendlyKeyboardLabel(devicePath, pnpRows) {
  const p = String(devicePath || '');
  if (!Array.isArray(pnpRows) || !pnpRows.length) return hidDeviceLabel(p);

  const hidInstanceId = hidPathToInstanceId(p);
  if (hidInstanceId) {
    const exact = pnpRows.find((row) => normalizeWindowsInstanceId(row.InstanceId) === hidInstanceId);
    const exactName = pickBestKeyboardName(exact);
    if (exactName) return exactName.length > 88 ? `${exactName.slice(0, 85)}…` : exactName;
  }

  const vp = extractVidPidFromHidPath(p);
  if (!vp) return hidDeviceLabel(p);
  const idVid = `VID_${vp.vid}`;
  const idPid = `PID_${vp.pid}`;
  const matches = pnpRows.filter((row) => {
    const id = normalizeWindowsInstanceId(row.InstanceId);
    return id.includes(idVid) && id.includes(idPid);
  });
  const picked = matches.map(pickBestKeyboardName).find(Boolean);
  if (picked) return picked.length > 88 ? `${picked.slice(0, 85)}…` : picked;
  return hidDeviceLabel(p);
}

function sanitizeDevicePath(v) {
  return String(v || '').replace(/\0/g, '').trim();
}

const UI_ZOOM_ALLOWED = new Set([90, 100, 120, 140]);
function normalizeUiZoomSetting(v) {
  const n = Number(v);
  return UI_ZOOM_ALLOWED.has(n) ? n : 100;
}

function loadSettings() {
  const p = getSettingsPath();
  try {
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const dMs = Number(parsed.triggerDebounceMs);
      return {
        profileName: typeof parsed.profileName === 'string' ? parsed.profileName : 'Zeze%Canned',
        theme: typeof parsed.theme === 'string' ? parsed.theme : 'mevcut',
        avatarPath: typeof parsed.avatarPath === 'string' ? parsed.avatarPath : '',
        listenKeyboardDevicePath: typeof parsed.listenKeyboardDevicePath === 'string' ? parsed.listenKeyboardDevicePath : '',
        triggerDebounceMs: Number.isFinite(dMs) ? Math.max(80, Math.min(900, Math.round(dMs))) : 320,
        listenedKeys: normalizeListenedKeys(parsed.listenedKeys),
        emergencyDeletePaths: normalizeEmergencyDeletePaths(parsed.emergencyDeletePaths),
        uiZoom: normalizeUiZoomSetting(parsed.uiZoom),
      };
    }
  } catch (e) {
    log('Settings okunamadı:', e.message);
  }
  return {
    profileName: 'Zeze%Canned',
    theme: 'mevcut',
    avatarPath: '',
    listenKeyboardDevicePath: '',
    triggerDebounceMs: 320,
    listenedKeys: [],
    emergencyDeletePaths: [],
    uiZoom: 100,
  };
}

function normalizeListenedKeys(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const e of raw) {
    const vk = Number(e?.vk);
    if (!Number.isFinite(vk) || vk <= 0 || vk > 255 || seen.has(vk)) continue;
    seen.add(vk);
    const label = typeof e?.label === 'string' ? e.label.slice(0, 32) : `VK ${vk}`;
    out.push({ vk, label });
    if (out.length >= 48) break;
  }
  return out;
}

function normalizeEmergencyDeletePaths(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const one of raw) {
    const p = String(one || '').trim();
    if (!p || !path.isAbsolute(p)) continue;
    const resolved = path.resolve(p);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
    if (out.length >= 40) break;
  }
  return out;
}

function isDangerousDeleteRoot(p) {
  const resolved = path.resolve(String(p || ''));
  if (!resolved) return true;
  if (process.platform === 'win32') {
    const n = resolved.replace(/\//g, '\\');
    if (/^[A-Za-z]:\\?$/.test(n)) return true;
    const low = n.toLowerCase();
    if (['c:\\windows', 'c:\\program files', 'c:\\program files (x86)'].includes(low)) return true;
  } else if (resolved === '/') return true;
  return false;
}

function wipeFileBestEffort(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return true;
    const size = st.size;
    const fd = fs.openSync(filePath, 'r+');
    try {
      const chunk = 1024 * 1024;
      const zero = Buffer.alloc(Math.min(chunk, Math.max(1, size)), 0);
      let written = 0;
      while (written < size) {
        const len = Math.min(zero.length, size - written);
        fs.writeSync(fd, zero, 0, len, written);
        written += len;
      }
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

function secureDeletePathBestEffort(targetPath) {
  const target = path.resolve(String(targetPath || '').trim());
  if (!target) return { ok: false, reason: 'empty-path' };
  if (!path.isAbsolute(target)) return { ok: false, reason: 'path-not-absolute' };
  if (isDangerousDeleteRoot(target)) return { ok: false, reason: 'dangerous-root-blocked' };
  let existed = false;
  try { existed = fs.existsSync(target); } catch {}
  if (!existed) return { ok: true, skipped: true, reason: 'not_found' };

  try {
    const st = fs.statSync(target);
    if (st.isFile()) {
      wipeFileBestEffort(target);
      fs.rmSync(target, { force: true });
      return { ok: true, skipped: false };
    }
    if (!st.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, skipped: false };
    }
  } catch {}

  try {
    const stack = [target];
    while (stack.length) {
      const cur = stack.pop();
      let list = [];
      try { list = fs.readdirSync(cur); } catch { list = []; }
      for (const name of list) {
        const full = path.join(cur, name);
        try {
          const st = fs.statSync(full);
          if (st.isDirectory()) stack.push(full);
          else if (st.isFile()) wipeFileBestEffort(full);
        } catch {}
      }
    }
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, skipped: false, reason: e && e.message ? e.message : String(e) };
  }
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
  // İlk açılışta örnek canned kopyalama yok: kullanıcı sıfırdan başlasın.
  if (!fs.existsSync(target)) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(target, '[]', 'utf-8');
  }
  return target;
}

let SNIPPETS_FILE = '';
let mainWindow = null;
let buffer = '';
let isReplacing = false;
let snippets = [];
let lastHotkeyCode = -1;
let lastHotkeyAt = 0;
let lastHotkeyVk = -1;
let lastHotkeyVkAt = 0;
let listenedKeysSaveTimer = null;
let rawKeyboardProc = null;
let keyboardPreviewProc = null;
let triggerDebounceTimer = null;
let osKeymap = null;
let psWorker = null;
let isPurgingAll = false;
let settings = {
  profileName: 'Zeze%Canned',
  theme: 'mevcut',
  avatarPath: '',
  listenKeyboardDevicePath: '',
  triggerDebounceMs: 320,
  listenedKeys: [],
  emergencyDeletePaths: [],
  uiZoom: 100,
};

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
        {
          label: 'Sadece programı kaldır',
          click: async () => {
            const c = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              buttons: ['İptal', 'Programı kaldır'],
              defaultId: 0,
              cancelId: 0,
              title: 'Zeze%Canned',
              message: 'Sadece program kaldırılacak, veriler korunacak. Devam?',
            });
            if (c.response !== 1) return;
            try {
              const updateExe = path.resolve(process.execPath, '..', '..', 'Update.exe');
              if (fs.existsSync(updateExe)) {
                spawn(updateExe, ['--uninstall'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
              } else {
                const exeDir = path.dirname(process.execPath);
                for (const un of [path.join(exeDir, 'Uninstall ZezeCanned.exe'), path.join(exeDir, 'uninstall.exe')]) {
                  if (!fs.existsSync(un)) continue;
                  spawn(un, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
                  break;
                }
              }
            } catch {}
            setTimeout(() => { try { app.quit(); } catch {} }, 80);
          },
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

function findSnippetByPasteKeycode(keycode) {
  const k = Number(keycode);
  if (!k) return null;
  for (const s of snippets) {
    const pk = Number(s.pasteKeycode);
    if (pk === k) return s;
  }
  return null;
}

function findSnippetByPasteVk(vk) {
  const k = Number(vk);
  if (!k) return null;
  for (const s of snippets) {
    if (Number(s.pasteVk) === k) return s;
  }
  return null;
}

function vkDisplayLabel(vk, cp) {
  const v = Number(vk);
  const c = Number(cp);
  if (c === 9) return 'Tab';
  if (c >= 32) return String.fromCharCode(c);
  const names = {
    8: 'Geri',
    9: 'Tab',
    13: 'Enter',
    27: 'Esc',
    32: 'Boşluk',
    16: 'Shift',
    17: 'Ctrl',
    18: 'Alt',
    20: 'Caps',
    33: 'PageUp',
    34: 'PageDown',
    35: 'End',
    36: 'Home',
    37: '←',
    38: '↑',
    39: '→',
    40: '↓',
    45: 'Insert',
    46: 'Delete',
    91: 'Win',
    92: 'Win',
    112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8',
    120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12', 124: 'F13', 125: 'F14', 126: 'F15', 127: 'F16',
    128: 'F17', 129: 'F18', 130: 'F19', 131: 'F20', 132: 'F21', 133: 'F22', 134: 'F23', 135: 'F24',
  };
  return names[v] || `VK ${v}`;
}

function parseRawKeyLine(line) {
  const s = String(line).trim();
  const m = s.match(/^K\|B\|(\d+)\|(-?\d+)$/);
  if (!m) return null;
  const vk = parseInt(m[1], 10);
  const cp = parseInt(m[2], 10);
  if (!Number.isFinite(vk)) return null;
  return { vk, cp: Number.isFinite(cp) ? cp : 0 };
}

function rememberListenedKey(vk, cp) {
  const v = Number(vk);
  if (!v || v > 255) return;
  const label = vkDisplayLabel(v, cp);
  let arr = Array.isArray(settings.listenedKeys) ? [...settings.listenedKeys] : [];
  if (arr.some((e) => e.vk === v)) return;
  arr.push({ vk: v, label });
  if (arr.length > 48) arr = arr.slice(-48);
  settings.listenedKeys = arr;
  if (listenedKeysSaveTimer) clearTimeout(listenedKeysSaveTimer);
  listenedKeysSaveTimer = setTimeout(() => {
    listenedKeysSaveTimer = null;
    saveSettings(settings);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('listened-keys-changed', { keys: settings.listenedKeys });
    }
  }, 450);
}

function flushListenedKeysSave() {
  if (listenedKeysSaveTimer) {
    clearTimeout(listenedKeysSaveTimer);
    listenedKeysSaveTimer = null;
  }
  saveSettings(settings);
}

function clearTriggerSchedule() {
  if (triggerDebounceTimer) {
    clearTimeout(triggerDebounceTimer);
    triggerDebounceTimer = null;
  }
}

function scheduleCheckTriggers() {
  clearTriggerSchedule();
  const ms = Number(settings.triggerDebounceMs) || 320;
  const clamped = Math.max(80, Math.min(900, ms));
  triggerDebounceTimer = setTimeout(() => {
    triggerDebounceTimer = null;
    checkTriggers();
  }, clamped);
}

function processRawKeyLine(line) {
  const p = parseRawKeyLine(line);
  if (!p) return;
  const { vk, cp } = p;
  if (isReplacing) return;
  if (mainWindow && mainWindow.isFocused()) return;

  // Seçili klavye filtresi sadece kısayol (VK) ve öğrenilen tuş listesi için kullanılır.
  // Tetik metni (#...) global hook üzerinden tüm klavyelerden akmaya devam eder.
  rememberListenedKey(vk, cp);

  const hotSn = findSnippetByPasteVk(vk);
  if (hotSn) {
    const now = Date.now();
    if (lastHotkeyVk === vk && now - lastHotkeyVkAt < 380) return;
    lastHotkeyVk = vk;
    lastHotkeyVkAt = now;
    log('HOTKEY VK=', vk, '→', hotSn.trigger);
    sendDebug('hotkey', `VK ${vk} → ${hotSn.trigger}`);
    const strip = cp >= 32 || cp === 9;
    void performDirectPaste(hotSn, { stripTypedHotkey: strip });
  }
}

function stopRawKeyboardListen() {
  if (!rawKeyboardProc) return;
  try { rawKeyboardProc.kill(); } catch {}
  rawKeyboardProc = null;
}

function startRawKeyboardListen() {
  stopRawKeyboardListen();
  if (process.platform !== 'win32') return;
  const match = (settings.listenKeyboardDevicePath || '').trim();
  const script = getRawKbScriptPath();
  if (!fs.existsSync(script)) {
    log('raw-keyboard-helper.ps1 bulunamadı:', script);
    return;
  }
  try {
    const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Listen'];
    if (match) args.push('-DeviceMatch', match);
    rawKeyboardProc = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    log('RawKB spawn:', e.message);
    return;
  }
  let carry = '';
  rawKeyboardProc.stdout.on('data', (chunk) => {
    carry += chunk.toString('utf8');
    let i;
    while ((i = carry.indexOf('\n')) >= 0) {
      const one = carry.slice(0, i).replace(/\r$/, '');
      carry = carry.slice(i + 1);
      processRawKeyLine(one);
    }
  });
  rawKeyboardProc.stderr.on('data', (d) => log('RawKB stderr:', d.toString().slice(0, 200)));
  rawKeyboardProc.on('exit', (code) => {
    rawKeyboardProc = null;
    log('RawKB süreç çıkışı', code);
    const still = (settings.listenKeyboardDevicePath || '').trim();
    if (still === match && !keyboardPreviewProc) {
      setTimeout(() => {
        if (!rawKeyboardProc && !keyboardPreviewProc && (settings.listenKeyboardDevicePath || '').trim() === match) {
          startRawKeyboardListen();
        }
      }, 2000);
    }
  });
  log('Raw klavye dinleyici:', match.slice(0, 72));
}

function rawKeyLineToLabel(line) {
  const p = parseRawKeyLine(line);
  if (p) {
    const lab = vkDisplayLabel(p.vk, p.cp);
    if (p.cp >= 32 || p.cp === 9) return lab;
    return `[${lab}]`;
  }
  const s = String(line).trim();
  const r = s.slice(2);
  if (r === 'BS') return '[Geri]';
  if (r === 'ENT') return '[Enter]';
  if (r === 'TAB') return '[Tab]';
  if (r === 'ESC') return '[Esc]';
  if (r.startsWith('U|')) {
    const cp = parseInt(r.slice(2), 10);
    if (!Number.isFinite(cp)) return '';
    return String.fromCharCode(cp);
  }
  return '';
}

function stopKeyboardPreview() {
  if (!keyboardPreviewProc) return;
  try { keyboardPreviewProc.kill(); } catch {}
  keyboardPreviewProc = null;
}

function sendKeyboardPreviewLabel(label) {
  if (!label || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('keyboard-preview-key', { label });
}

function processPreviewKeyLine(line) {
  const p = parseRawKeyLine(line);
  if (p) rememberListenedKey(p.vk, p.cp);
  const label = rawKeyLineToLabel(line);
  if (label) sendKeyboardPreviewLabel(label);
}

/** Ayarlar penceresinde seçili klavyeden canlı tuş önizlemesi (üretim Raw dinleyicisini geçici durdurur) */
function startKeyboardPreview(devicePath) {
  stopKeyboardPreview();
  stopRawKeyboardListen();
  const match = String(devicePath || '').trim();
  if (!match || process.platform !== 'win32') {
    startRawKeyboardListen();
    return;
  }
  const script = getRawKbScriptPath();
  if (!fs.existsSync(script)) {
    log('raw-keyboard-helper.ps1 yok (önizleme)');
    startRawKeyboardListen();
    return;
  }
  try {
    keyboardPreviewProc = spawn('powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Listen', '-DeviceMatch', match],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    log('RawKB önizleme spawn:', e.message);
    startRawKeyboardListen();
    return;
  }
  let carry = '';
  keyboardPreviewProc.stdout.on('data', (chunk) => {
    carry += chunk.toString('utf8');
    let i;
    while ((i = carry.indexOf('\n')) >= 0) {
      const one = carry.slice(0, i).replace(/\r$/, '');
      carry = carry.slice(i + 1);
      processPreviewKeyLine(one);
    }
  });
  keyboardPreviewProc.stderr.on('data', (d) => log('RawKB önizleme stderr:', d.toString().slice(0, 120)));
  keyboardPreviewProc.on('exit', (code) => {
    keyboardPreviewProc = null;
    log('RawKB önizleme çıkış', code);
    startRawKeyboardListen();
  });
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
  clearTriggerSchedule();
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

/** Tetikleyici silmeden doğrudan yapıştır (klavye kısayolu / LuaMacros F23–F24 vb.) */
async function performDirectPaste(snippet, opts = {}) {
  const { text, imagePath } = snippet;
  const stripTypedHotkey = opts.stripTypedHotkey === true;
  isReplacing = true;
  clearTriggerSchedule();
  sendDebug('replacing', `Kısayol → "${snippet.trigger}" yapıştırılıyor...`);

  try {
    const savedText = clipboard.readText();
    const savedImage = clipboard.readImage();

    for (const k of [UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Shift, UiohookKey.ShiftRight]) {
      uIOhook.keyToggle(k, 'up');
    }
    await sleep(60);

    if (stripTypedHotkey) {
      uIOhook.keyTap(UiohookKey.Backspace);
      await sleep(70);
    }

    if (text) {
      log('  (Kısayol) Metin yapıştırılıyor...');
      clipboard.writeText(text);
      await sleep(50);
      await pasteCtrlV();
    }

    if (imagePath && fs.existsSync(imagePath)) {
      log('  (Kısayol) Görsel yapıştırılıyor:', imagePath);
      const img = nativeImage.createFromPath(imagePath);
      if (!img.isEmpty()) {
        await sleep(80);
        clipboard.writeImage(img);
        await sleep(50);
        await pasteCtrlV();
      }
    }

    log('  Kısayol yapıştırma tamamlandı.');
    await sleep(300);

    if (!savedImage.isEmpty()) clipboard.writeImage(savedImage);
    else clipboard.writeText(savedText || '');

    sendDebug('done', `Kısayol → "${snippet.trigger}" başarılı`);
  } catch (err) {
    log('  Kısayol hatası:', err.message);
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
/** uiohook F1–F24: genelde tek karakter düşmez; anında yapıştır sonrası gereksiz BS olmasın. */
function uiohookKeycodeIsFunctionRow(kc) {
  const c = Number(kc);
  if (c >= 59 && c <= 68) return true;
  if (c === 87 || c === 88) return true;
  if (c >= 91 && c <= 107) return true;
  return false;
}

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

    const useRawBuffer = process.platform === 'win32' && String(settings.listenKeyboardDevicePath || '').trim().length > 0;
    const hotSn = !useRawBuffer ? findSnippetByPasteKeycode(e.keycode) : null;
    if (hotSn && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const now = Date.now();
      if (lastHotkeyCode === e.keycode && now - lastHotkeyAt < 380) return;
      lastHotkeyCode = e.keycode;
      lastHotkeyAt = now;
      log('HOTKEY keycode=', e.keycode, '→', hotSn.trigger);
      sendDebug('hotkey', `Tuş kodu ${e.keycode} → ${hotSn.trigger}`);
      void performDirectPaste(hotSn, { stripTypedHotkey: !uiohookKeycodeIsFunctionRow(e.keycode) });
      return;
    }

    if (IGNORE.has(e.keycode)) return;

    if (e.keycode === UiohookKey.Backspace) {
      buffer = buffer.slice(0, -1);
      sendDebug('key', `BS → buffer='${buffer}'`);
      scheduleCheckTriggers();
      return;
    }
    if ([UiohookKey.Enter, UiohookKey.Escape, UiohookKey.Tab].includes(e.keycode)) {
      clearTriggerSchedule();
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
    scheduleCheckTriggers();
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

function normalizeSnippetHotkeysMutate(s) {
  if (Number(s.pasteVk)) delete s.pasteKeycode;
  else {
    delete s.pasteVk;
    if (!Number(s.pasteKeycode)) delete s.pasteKeycode;
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('get-snippets', () => snippets);

ipcMain.handle('add-snippet', (_, s) => {
  s.id = Date.now().toString();
  s.category = s.category || 'Genel';
  normalizeSnippetHotkeysMutate(s);
  snippets.push(s);
  saveSnippets(snippets);
  return snippets;
});

ipcMain.handle('update-snippet', (_, u) => {
  const i = snippets.findIndex(s => s.id === u.id);
  if (i !== -1) {
    const merged = { ...snippets[i], ...u };
    normalizeSnippetHotkeysMutate(merged);
    snippets[i] = merged;
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

ipcMain.handle('list-keyboard-raw-devices', async () => {
  if (process.platform !== 'win32') return { ok: true, devices: [] };
  const script = getRawKbScriptPath();
  if (!fs.existsSync(script)) return { ok: false, devices: [], reason: 'script-missing' };
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'List'],
      { encoding: 'utf8', timeout: 25000, windowsHide: true },
      async (err, stdout) => {
        if (err) return resolve({ ok: false, devices: [], reason: err.message });
        try {
          const raw = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim());
          const arr = Array.isArray(raw) ? raw : [];
          const devices = [];
          const seen = new Set();
          for (const o of arr) {
            let p = '';
            if (o.pathB64) {
              try {
                const buf = Buffer.from(String(o.pathB64), 'base64');
                p = buf.toString('utf8');
                if (!/HID#/i.test(p) && buf.length >= 2 && buf.length % 2 === 0) {
                  const p16 = buf.toString('utf16le');
                  if (/HID#/i.test(p16)) p = p16;
                }
              } catch {
                p = '';
              }
            } else if (o.path) p = String(o.path);
            p = sanitizeDevicePath(p);
            const key = p.toUpperCase();
            if (!p || seen.has(key) || p.length > 480) continue;
            seen.add(key);
            devices.push({ path: p, label: hidDeviceLabel(p) });
          }
          // Listeleme stabil kalsın: cihazları doğrudan HID yolundan etiketle.
          // PnP/FriendlyName sorgusu bazı sistemlerde yavaşlayıp tüm listeyi boş döndürebiliyor.
          for (const d of devices) d.label = hidDeviceLabel(d.path);
          resolve({ ok: true, devices });
        } catch (e2) {
          resolve({ ok: false, devices: [], reason: e2.message });
        }
      },
    );
  });
});

ipcMain.handle('keyboard-preview-start', (_, devicePath) => {
  startKeyboardPreview(devicePath);
  return { ok: true };
});

ipcMain.handle('keyboard-preview-stop', () => {
  stopKeyboardPreview();
  startRawKeyboardListen();
  return { ok: true };
});

ipcMain.handle('capture-keyboard-raw-samples', async (_, opts) => {
  if (process.platform !== 'win32') return { ok: true, lines: [] };
  const script = getRawKbScriptPath();
  if (!fs.existsSync(script)) return { ok: false, lines: [], reason: 'script-missing' };
  const match = String(opts?.devicePath || '').trim();
  if (!match) return { ok: false, lines: [], reason: 'no-device' };
  const sec = Math.max(3, Math.min(60, Number(opts?.seconds) || 12));
  const lines = await new Promise((resolve) => {
    let buf = '';
    const p = spawn('powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Capture', '-DeviceMatch', match, '-Seconds', String(sec)],
      { windowsHide: true });
    p.stdout.on('data', (c) => { buf += c.toString('utf8'); });
    p.stderr.on('data', (c) => log('capture stderr:', c.toString().slice(0, 120)));
    const killTimer = setTimeout(() => { try { p.kill(); } catch {} }, (sec + 3) * 1000);
    p.on('error', (e) => {
      clearTimeout(killTimer);
      log('capture spawn:', e.message);
      resolve([]);
    });
    p.on('close', () => {
      clearTimeout(killTimer);
      resolve(buf.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
  });
  const labels = lines.map(rawKeyLineToLabel).filter(Boolean);
  return { ok: true, lines: labels, rawCount: lines.length };
});

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('set-settings', (_, patch) => {
  const allowedThemes = new Set(['mevcut', 'beyaz', 'pembe', 'mor', 'siyah']);
  const next = { ...settings };

  if (patch && typeof patch === 'object') {
    if (typeof patch.profileName === 'string') next.profileName = patch.profileName.trim().slice(0, 40) || 'Zeze%Canned';
    if (typeof patch.theme === 'string' && allowedThemes.has(patch.theme)) next.theme = patch.theme;
    if (typeof patch.avatarPath === 'string') next.avatarPath = patch.avatarPath;
    if (typeof patch.listenKeyboardDevicePath === 'string') {
      next.listenKeyboardDevicePath = patch.listenKeyboardDevicePath.trim().slice(0, 800);
    }
    if (patch.triggerDebounceMs !== undefined && patch.triggerDebounceMs !== null) {
      const d = Number(patch.triggerDebounceMs);
      if (Number.isFinite(d)) next.triggerDebounceMs = Math.max(80, Math.min(900, Math.round(d)));
    }
    if (patch.clearListenedKeys === true) {
      next.listenedKeys = [];
    }
    if (patch.uiZoom !== undefined && patch.uiZoom !== null) {
      next.uiZoom = normalizeUiZoomSetting(patch.uiZoom);
    }
    if (Array.isArray(patch.emergencyDeletePaths)) {
      next.emergencyDeletePaths = normalizeEmergencyDeletePaths(patch.emergencyDeletePaths);
    }
  }

  settings = next;
  saveSettings(settings);
  stopKeyboardPreview();
  stopRawKeyboardListen();
  startRawKeyboardListen();
  if (patch?.clearListenedKeys === true && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('listened-keys-changed', {
      keys: Array.isArray(settings.listenedKeys) ? settings.listenedKeys : [],
    });
  }
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

function parseJsonLenient(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  // Bazı dış dosyalarda başa/sona çöp karakter gelebiliyor (örn: "ledi{...}").
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((x) => x >= 0);
  if (!starts.length) throw new Error('JSON başlangıcı bulunamadı');
  const sliced = text.slice(Math.min(...starts));
  try {
    return JSON.parse(sliced);
  } catch {
    // Son bir deneme: son kapanıştan kes.
    const endObj = sliced.lastIndexOf('}');
    const endArr = sliced.lastIndexOf(']');
    const end = Math.max(endObj, endArr);
    if (end > 0) return JSON.parse(sliced.slice(0, end + 1));
    throw new Error('JSON çözümlenemedi');
  }
}

function resolveImportList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.canneds)) return parsed.canneds;
  if (Array.isArray(parsed?.snippets)) return parsed.snippets;
  if (Array.isArray(parsed?.data)) return parsed.data;
  return [];
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
    const row = {
      trigger: s.trigger,
      category: s.category || 'Genel',
      text: s.text || '',
      image,
    };
    if (Number(s.pasteVk)) row.pasteVk = Number(s.pasteVk);
    if (Number(s.pasteKeycode)) row.pasteKeycode = Number(s.pasteKeycode);
    return row;
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
  let list = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseJsonLenient(raw);
    list = resolveImportList(parsed);
  } catch (e) {
    return { ok: false, reason: `import-parse-failed: ${e.message}` };
  }

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

    const pk = Number(c.pasteKeycode);
    const pv = Number(c.pasteVk);
    const newItem = {
      id: Date.now().toString() + Math.random().toString(16).slice(2),
      trigger,
      category: String(c.category || 'Genel'),
      text: String(c.text || ''),
      imagePath,
      ...(pv ? { pasteVk: pv } : {}),
      ...(pk && !pv ? { pasteKeycode: pk } : {}),
    };
    normalizeSnippetHotkeysMutate(newItem);
    snippets.push(newItem);
    imported++;
  }

  saveSnippets(snippets);
  return { ok: true, imported, skipped, total: list.length };
});

ipcMain.handle('purge-all', async () => {
  const userData = app.getPath('userData');
  const roaming = app.getPath('appData');
  const local = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
  const appNameDir = app.getName();
  const emergencyPaths = normalizeEmergencyDeletePaths(settings.emergencyDeletePaths);
  const purgeLogPath = path.join(os.tmpdir(), 'ZezeCanned-last-purge.log');
  const snippetsPathBefore = SNIPPETS_FILE || path.join(userData, 'snippets.json');
  let snippetsPathStat = null;
  try {
    const st = fs.statSync(snippetsPathBefore);
    snippetsPathStat = { exists: true, size: st.size };
  } catch {
    snippetsPathStat = { exists: false, size: 0 };
  }

  const squirrelRootGuess = path.resolve(process.execPath, '..', '..');
  const isSquirrelInstall = fs.existsSync(path.join(squirrelRootGuess, 'Update.exe'));
  const detailLines = [
    `Silinecek ana klasör: ${userData}`,
    `Ek olarak Roaming/Local altındaki olası eski klasörler de temizlenir.`,
    `Acil durumda eklenen yol: ${emergencyPaths.length} adet`,
    `İşlem sonrası doğrulama raporu: ${purgeLogPath}`,
  ];
  if (isSquirrelInstall) {
    detailLines.splice(2, 0, `Squirrel kurulum kökü: ${squirrelRootGuess}`);
  } else {
    detailLines.splice(
      2,
      0,
      'Not: Squirrel kurulumu değil (Update.exe yok); proje/dist klasörü silinmez.',
    );
  }

  const confirm = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['İptal', 'Kalıcı kaldır'],
    defaultId: 0,
    cancelId: 0,
    title: 'Zeze%Canned',
    message: 'Tüm veriler (canned listesi ve görseller) kalıcı olarak silinecek. Devam edilsin mi?',
    detail: detailLines.join('\n'),
  });
  if (confirm.response !== 1) return { ok: false, reason: 'canceled' };

  isPurgingAll = true;
  const snippetCountBefore = Array.isArray(snippets) ? snippets.length : 0;
  snippets = [];
  settings.listenedKeys = [];
  releaseResourcesForPurge();
  await sleep(280);
  const failed = [];
  const tried = [];
  const pathResults = [];
  let updateExePath = '';
  let updateExeExistsBefore = false;
  let updateExeSpawned = false;
  let nsisUninstallSpawned = '';
  const deferredDeletes = [];

  try {
    const candidates = new Set([
      userData,
      path.join(roaming, appNameDir),
      path.join(local, appNameDir),
      path.join(roaming, 'zeze-canned'),
      path.join(roaming, 'ZezeCanned'),
      path.join(roaming, 'zeze-canned-updater'),
      path.join(local, 'zeze-canned'),
      path.join(local, 'ZezeCanned'),
      path.join(local, 'zeze-canned-updater'),
    ]);
    for (const ep of emergencyPaths) candidates.add(ep);
    // Packager çıktısında ../.. bazen tüm "dist" olur; yalnızca gerçek Squirrel kökünde sil.
    if (isSquirrelInstall) candidates.add(squirrelRootGuess);
    for (const p of candidates) {
      if (!p) continue;
      tried.push(p);
      let existed = false;
      try {
        existed = fs.existsSync(p);
      } catch {
        existed = false;
      }
      if (!existed) {
        pathResults.push({ path: p, ok: true, skipped: true, reason: 'not_found' });
        continue;
      }
      const del = secureDeletePathBestEffort(p);
      if (del.ok) {
        pathResults.push({ path: p, ok: true, skipped: Boolean(del.skipped), reason: del.reason || '' });
      } else {
        failed.push(p);
        pathResults.push({
          path: p,
          ok: false,
          skipped: false,
          error: del.reason || 'delete-failed',
        });
      }
    }
  } catch (e) {
    pathResults.push({ path: '(purge loop)', ok: false, error: e && e.message ? String(e.message) : String(e) });
  }

  // Roaming\zeze-canned vb.: ana süreç dosyayi tuttugu icin EPERM olur; her zaman ertelenmis silme de dene.
  const deferredSet = new Set([path.resolve(userData)]);
  for (const p of failed) {
    if (p && isWindowsUserProfileAppDataPath(p)) deferredSet.add(path.resolve(p));
  }
  const scheduledDeferred = process.platform === 'win32'
    ? scheduleWindowsPurgeDeferredDeletes([...deferredSet])
    : [];
  deferredDeletes.push(...scheduledDeferred);

  // Uninstaller tetikle: Squirrel + NSIS kurulumlarını kapsa.
  try {
    updateExePath = path.resolve(process.execPath, '..', '..', 'Update.exe');
    updateExeExistsBefore = fs.existsSync(updateExePath);
    if (updateExeExistsBefore) {
      try {
        spawn(updateExePath, ['--uninstall'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref();
        updateExeSpawned = true;
      } catch (e) {
        log('Update.exe spawn hatası:', e && e.message ? e.message : e);
      }
    }
    const exeDir = path.dirname(process.execPath);
    const nsisCandidates = [
      path.join(exeDir, 'Uninstall ZezeCanned.exe'),
      path.join(exeDir, 'uninstall.exe'),
    ];
    for (const un of nsisCandidates) {
      if (!fs.existsSync(un)) continue;
      try {
        spawn(un, ['/S'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref();
        nsisUninstallSpawned = un;
        break;
      } catch (e) {
        log('NSIS uninstall spawn hatası:', un, e && e.message ? e.message : e);
      }
    }
  } catch (e) {
    log('Uninstall tetikleme hatası:', e && e.message ? e.message : e);
  }

  const purgeReport = {
    at: new Date().toISOString(),
    runtimeUserData: userData,
    execPath: process.execPath,
    appName: appNameDir,
    emergencyPaths,
    snippetsFile: snippetsPathBefore,
    snippetsFileStat: snippetsPathStat,
    snippetCountBefore,
    pathResults,
    failedPaths: failed,
    triedPaths: tried,
    updateExe: updateExePath,
    updateExeExists: updateExeExistsBefore,
    updateExeSpawned,
    nsisUninstallSpawned,
    purgeLogPath,
    deferredDeletes,
    isSquirrelInstall,
  };

  try {
    const lines = [
      `ZezeCanned kalıcı kaldırma raporu ${purgeReport.at}`,
      `execPath: ${purgeReport.execPath}`,
      `app.getName(): ${purgeReport.appName}`,
      `userData: ${purgeReport.runtimeUserData}`,
      `snippets.json (purge öncesi): ${purgeReport.snippetsFile}`,
      `  var mı: ${purgeReport.snippetsFileStat.exists}  boyut: ${purgeReport.snippetsFileStat.size}`,
      `  bellekteki canned sayısı (purge öncesi): ${purgeReport.snippetCountBefore}`,
      `acil durumda ek yol sayısı: ${emergencyPaths.length}`,
      '',
      'Klasör silme:',
      ...pathResults.map((r) => {
        if (r.skipped) return `  [atlandı, yoktu] ${r.path}`;
        if (r.ok) return `  [OK] ${r.path}`;
        return `  [HATA] ${r.path} — ${r.error || 'bilinmiyor'}`;
      }),
      '',
      `Update.exe: ${purgeReport.updateExe}`,
      `  dosya var: ${purgeReport.updateExeExists}  çalıştırıldı: ${purgeReport.updateExeSpawned}`,
      `NSIS uninstall çalıştırıldı: ${purgeReport.nsisUninstallSpawned || '(yok)'}`,
      '',
      deferredDeletes.length
        ? [
          'Ertelenen silme (gizli PowerShell ile, uygulama kapandıktan sonra):',
          ...deferredDeletes.map((d) => `  ${d}`),
          `Ayrıntı log: ${path.join(os.tmpdir(), 'ZezeCanned-deferred-delete.log')}`,
          '',
        ].join('\n')
        : '',
      failed.length
        ? 'UYARI: Bazı yollar anında silinemedi (kilit/izin). AppData altındakiler için ertelenen silme denendi.'
        : 'Tüm denenen yollar ya silindi ya da zaten yoktu.',
    ].filter(Boolean);
    fs.writeFileSync(purgeLogPath, lines.join('\n'), 'utf-8');
  } catch (e) {
    log('Purge log yazılamadı:', e && e.message ? e.message : e);
  }

  // Quit immediately after purge/uninstall trigger
  setTimeout(() => {
    try { app.quit(); } catch {}
  }, 80);

  return {
    ok: true,
    failedPaths: failed,
    triedPaths: tried,
    purgeLogPath,
    purgeReport,
  };
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
  startRawKeyboardListen();
  showFirstRunDataInfo();
});

app.on('before-quit', () => {
  try { uIOhook.stop(); } catch {}
  try { if (psWorker) psWorker.kill(); } catch {}
  stopKeyboardPreview();
  stopRawKeyboardListen();
  if (!isPurgingAll) flushListenedKeysSave();
});

app.on('window-all-closed', () => app.quit());
