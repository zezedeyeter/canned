#Requires -Version 5.0
param(
  [Parameter(Mandatory = $true)][ValidateSet('List', 'Capture', 'Listen')][string]$Action,
  [string]$DeviceMatch = '',
  [int]$Seconds = 15
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$cs = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public static class RawKb {
  const int WM_INPUT = 0x00FF;
  const int RID_INPUT = 0x10000003;
  const int RIM_TYPEKEYBOARD = 1;
  const int RIDI_DEVICENAME = 0x20000007;
  const int RIDEV_INPUTSINK = 0x00000100;
  const ushort RI_KEY_BREAK = 1;

  [StructLayout(LayoutKind.Sequential)]
  public struct RAWINPUTDEVICELIST {
    public IntPtr hDevice;
    public uint dwType;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct RAWINPUTDEVICE {
    public ushort usUsagePage;
    public ushort usUsage;
    public uint dwFlags;
    public IntPtr hwndTarget;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct RAWINPUTHEADER {
    public int dwType;
    public int dwSize;
    public IntPtr hDevice;
    public IntPtr wParam;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct RAWKEYBOARD {
    public ushort MakeCode;
    public ushort Flags;
    public ushort Reserved;
    public ushort VKey;
    public uint Message;
    public uint ExtraInformation;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint GetRawInputDeviceList(IntPtr pRawInputDeviceList, ref uint puiNumDevices, uint cbSize);

  [DllImport("user32.dll", EntryPoint = "GetRawInputDeviceInfoW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetRawInputDeviceInfo(IntPtr hDevice, uint uiCommand, IntPtr pData, ref uint pcbSize);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] pRawInputDevices, uint uiNumDevices, uint cbSize);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint GetRawInputData(IntPtr hRawInput, uint uiCommand, IntPtr pData, ref uint pcbSize, uint cbSizeHeader);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int ToUnicode(uint wVirtKey, uint wScanCode, byte[] lpKeyState,
    [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszBuff, int cchBuff, uint wFlags);

  public static string GetDeviceName(IntPtr h) {
    // İlk çağrı: pcbSize = WCHAR sayısı (null dahil), bayt DEĞİL — yanlış AllocHGlobal mojibake üretir.
    uint charCount = 0;
    if (GetRawInputDeviceInfo(h, RIDI_DEVICENAME, IntPtr.Zero, ref charCount) == unchecked((uint)-1)) return "";
    if (charCount < 2) return "";
    int byteLen = checked((int)(charCount * 2));
    IntPtr buf = Marshal.AllocHGlobal(byteLen);
    try {
      // RIDI_DEVICENAME için pcbSize giriş/çıkış birimi WCHAR sayısıdır.
      uint pcb = charCount;
      if (GetRawInputDeviceInfo(h, RIDI_DEVICENAME, buf, ref pcb) == unchecked((uint)-1)) return "";
      int len = (int)Math.Max(0, Math.Min(pcb, charCount) - 1); // son null hariç
      return len > 0 ? (Marshal.PtrToStringUni(buf, len) ?? "") : "";
    } finally { Marshal.FreeHGlobal(buf); }
  }

  public static string ListJson() {
    uint cb = (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICELIST));
    uint numDevices = 0;
    uint ret = GetRawInputDeviceList(IntPtr.Zero, ref numDevices, cb);
    if (ret == unchecked((uint)-1) || numDevices == 0) return "[]";
    RAWINPUTDEVICELIST[] arr = new RAWINPUTDEVICELIST[numDevices];
    GCHandle h = GCHandle.Alloc(arr, GCHandleType.Pinned);
    try {
      IntPtr p = h.AddrOfPinnedObject();
      uint n = numDevices;
      if (GetRawInputDeviceList(p, ref n, cb) == unchecked((uint)-1)) return "[]";
    } finally { h.Free(); }

    var parts = new List<string>();
    for (int i = 0; i < arr.Length; i++) {
      if (arr[i].dwType != RIM_TYPEKEYBOARD) continue;
      string nm = GetDeviceName(arr[i].hDevice);
      if (string.IsNullOrEmpty(nm)) continue;
      // UTF-8: Node/Electron tarafında utf16le yerine utf8 ile güvenli çözülür (HID yolu ASCII ağırlıklı)
      string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(nm));
      parts.Add("{\"pathB64\":\"" + b64 + "\"}");
    }
    return "[" + string.Join(",", parts) + "]";
  }

  static bool DeviceOk(string devName, string match) {
    if (string.IsNullOrEmpty(match)) return true;
    return devName.IndexOf(match, StringComparison.OrdinalIgnoreCase) >= 0;
  }

  static void EmitKey(RAWKEYBOARD kb) {
    if ((kb.Flags & RI_KEY_BREAK) != 0) return;
    ushort vk = kb.VKey;
    int cp = 0;
    byte[] st = new byte[256];
    StringBuilder sb = new StringBuilder(8);
    int r = ToUnicode(vk, kb.MakeCode, st, sb, sb.Capacity, 0);
    if (r == 1 && sb.Length > 0) {
      char ch = sb[0];
      if (ch == '\t' || ch >= ' ') cp = (int)ch;
    }
    Console.Out.WriteLine("K|B|" + vk + "|" + cp);
    Console.Out.Flush();
  }

  public class HostForm : Form {
    public string Match;
    public int CapMs;
    readonly System.Diagnostics.Stopwatch Sw = System.Diagnostics.Stopwatch.StartNew();

    public HostForm(string match, int capMs) {
      Match = match ?? "";
      CapMs = capMs;
      FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false;
      Opacity = 0;
      Size = new System.Drawing.Size(1, 1);
      StartPosition = FormStartPosition.Manual;
      Location = new System.Drawing.Point(-32000, -32000);
    }

    protected override void OnLoad(EventArgs e) {
      base.OnLoad(e);
      RAWINPUTDEVICE[] rid = new RAWINPUTDEVICE[1];
      rid[0].usUsagePage = 0x01;
      rid[0].usUsage = 0x06;
      rid[0].dwFlags = (uint)RIDEV_INPUTSINK;
      rid[0].hwndTarget = this.Handle;
      if (!RegisterRawInputDevices(rid, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE))))
        throw new Exception("RegisterRawInputDevices failed");
    }

    protected override void WndProc(ref Message m) {
      if (m.Msg == WM_INPUT) {
        uint sz = 0;
        uint hsz = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
        GetRawInputData(m.LParam, RID_INPUT, IntPtr.Zero, ref sz, hsz);
        if (sz == 0) { base.WndProc(ref m); return; }
        IntPtr buf = Marshal.AllocHGlobal((int)sz);
        try {
          uint sz2 = sz;
          if (GetRawInputData(m.LParam, RID_INPUT, buf, ref sz2, hsz) == unchecked((uint)-1)) { base.WndProc(ref m); return; }
          RAWINPUTHEADER hdr = (RAWINPUTHEADER)Marshal.PtrToStructure(buf, typeof(RAWINPUTHEADER));
          if (hdr.dwType != RIM_TYPEKEYBOARD) { base.WndProc(ref m); return; }
          int hdrLen = Marshal.SizeOf(typeof(RAWINPUTHEADER));
          RAWKEYBOARD kb = (RAWKEYBOARD)Marshal.PtrToStructure(IntPtr.Add(buf, hdrLen), typeof(RAWKEYBOARD));
          string dev = GetDeviceName(hdr.hDevice);
          if (!DeviceOk(dev, Match)) { base.WndProc(ref m); return; }
          EmitKey(kb);
        } finally { Marshal.FreeHGlobal(buf); }
      }
      base.WndProc(ref m);
      if (CapMs > 0 && Sw.ElapsedMilliseconds >= CapMs) Application.ExitThread();
    }
  }

  public static void RunLoop(string match, int capMs) {
    Application.EnableVisualStyles();
    Application.Run(new HostForm(match, capMs));
  }
}
'@

Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Windows.Forms, System.Drawing -Language CSharp

if ($Action -eq 'List') {
  [RawKb]::ListJson()
  exit 0
}

if ($Action -eq 'Capture' -and -not $DeviceMatch) {
  Write-Error "DeviceMatch gerekli (Capture)"
  exit 1
}

$capMs = if ($Action -eq 'Listen') { 0 } else { [Math]::Max(1500, $Seconds * 1000) }
[RawKb]::RunLoop($DeviceMatch, $capMs)
exit 0
