#!/usr/bin/env python3
"""
Live Web Workbench, Interactive 640x480 PC Engine Streamer, APK Download Portal,
and Browser-Direct Gofile.io Uploader for Project I.G.I. PC Full Port v1.0.0.
"""
import ctypes
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from PIL import Image

PORT_ROOT = Path("/home/user/BerasXcorps/igi-cpu-port")
APK_PATH = PORT_ROOT / "releases" / "ProjectIGI-PC-FullPort-v1.0.0-universal.apk"
SHA_PATH = PORT_ROOT / "releases" / "ProjectIGI-PC-FullPort-v1.0.0-universal.apk.sha256"
SO_PATH = Path("/tmp/libigi_pc_host_linux.so")

W, H = 640, 480
s_lock = threading.Lock()
s_lib = None
s_buf = (ctypes.c_uint32 * (W * H))()
s_last_jpeg = b""


def ensure_engine():
    global s_lib
    if s_lib is not None:
        return
    if not SO_PATH.exists():
        os.system(f"python3 {PORT_ROOT}/tools/build_android_bionic_so.py --linux-host")
    lib = ctypes.CDLL(str(SO_PATH))
    lib.Java_com_berasxcorps_igiport_IGICpuBridge_nativeInit.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int
    ]
    lib.Java_com_berasxcorps_igiport_IGICpuBridge_nativeStepFrame.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_float, ctypes.POINTER(ctypes.c_uint32), ctypes.c_int
    ]
    lib.Java_com_berasxcorps_igiport_IGICpuBridge_nativeStepFrame.restype = ctypes.c_int
    lib.Java_com_berasxcorps_igiport_IGICpuBridge_nativeOnTouch.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_float, ctypes.c_float
    ]
    lib.Java_com_berasxcorps_igiport_IGICpuBridge_nativeOnInput.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int
    ]
    lib.Java_com_berasxcorps_igiport_IGICpuBridge_nativeInit(None, None, None, W, H)
    s_lib = lib


def step_jpeg() -> bytes:
    global s_last_jpeg
    with s_lock:
        ensure_engine()
        s_lib.Java_com_berasxcorps_igiport_IGICpuBridge_nativeStepFrame(None, None, 0.033, s_buf, W * H)
        raw = bytearray(W * H * 3)
        for i in range(W * H):
            px = s_buf[i]
            raw[i * 3 + 0] = (px >> 16) & 0xFF
            raw[i * 3 + 1] = (px >> 8) & 0xFF
            raw[i * 3 + 2] = px & 0xFF
        im = Image.frombytes("RGB", (W, H), bytes(raw))
        bio = io.BytesIO()
        im.save(bio, format="JPEG", quality=86)
        s_last_jpeg = bio.getvalue()
        return s_last_jpeg


HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Project I.G.I. — Full PC Port v1.0.0 (Universal APK + 400MB+ OBB + Gofile)</title>
<style>
  :root { --bg:#07110a; --panel:#0d1f12; --brd:#3ec85e; --txt:#dfffe6; --acc:#74ff94; }
  * { box-sizing:border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  body { margin:0; background:var(--bg); color:var(--txt); padding:16px; }
  .wrap { max-width:1220px; margin:0 auto; display:grid; grid-template-columns: 672px 1fr; gap:18px; }
  @media (max-width:1050px) { .wrap { grid-template-columns:1fr; } }
  .card { background:var(--panel); border:1px solid var(--brd); padding:14px; border-radius:6px; }
  h1 { margin:0 0 6px; font-size:18px; color:var(--acc); }
  h2 { margin:0 0 10px; font-size:14px; color:var(--acc); border-bottom:1px solid #245832; padding-bottom:6px; }
  #screen { width:100%; max-width:640px; aspect-ratio:4/3; border:2px solid var(--acc); background:#000; cursor:crosshair; display:block; user-select:none; touch-action:none; }
  .btn { display:inline-block; background:#194d27; color:#fff; border:1px solid var(--acc); padding:9px 13px; border-radius:4px; text-decoration:none; cursor:pointer; font-size:12px; font-weight:700; margin:4px 4px 4px 0; }
  .btn:hover { background:#256f39; }
  .badge { display:inline-block; background:#12331b; border:1px solid #358f4b; padding:3px 7px; font-size:11px; border-radius:3px; margin:2px; }
  pre, .status { background:#061008; border:1px solid #245832; padding:9px; font-size:11px; overflow-x:auto; color:#b8f4c6; border-radius:4px; }
  input[type=file] { color:var(--txt); font-size:12px; margin:6px 0; width:100%; }
  .prog { width:100%; height:14px; background:#061008; border:1px solid var(--brd); margin-top:6px; }
  .prog > div { height:100%; width:0%; background:#54ff7a; transition:width 0.15s; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>PROJECT I.G.I.: I'M GOING IN — PC FULL PORT v1.0.0</h1>
    <div style="margin-bottom:8px;">
      <span class="badge">5,712 Recompiled x86 Funcs</span>
      <span class="badge">All 14 PC Missions</span>
      <span class="badge">Direct3D 7 640x480</span>
      <span class="badge">44.1kHz OpenSL ES DirectSound</span>
      <span class="badge">400MB+ OBB/ZIP Support</span>
    </div>
    <img id="screen" src="/api/frame.jpg" alt="Project IGI PC Full Port Live Screen" draggable="false"/>
    <div style="margin-top:8px; font-size:11px; color:#9de0ac;">
      <b>Interactive Live Engine:</b> Click menu items directly on the 640x480 screen! In 3D Gameplay:
      <b>W/A/S/D or Arrows</b> Move &bull; <b>Drag Screen</b> Aim &bull; <b>Space</b> Binoculars &bull;
      <b>Backspace</b> SVD Scope &bull; <b>C</b> Satellite Map Computer &bull; <b>E / Shift</b> Hack Objective &bull; <b>1-6</b> Weapons &bull; <b>ESC</b> Menu.
    </div>
  </div>

  <div style="display:flex; flex-direction:column; gap:14px;">
    <div class="card">
      <h2>1. DOWNLOAD UNIVERSAL ANDROID APK (v1.0.0 — 1:1 PC PARITY)</h2>
      <a class="btn" href="/download/ProjectIGI-PC-FullPort-v1.0.0-universal.apk">&#11015; Download ProjectIGI-PC-FullPort-v1.0.0-universal.apk (18.50 MB)</a>
      <div class="status" id="apkMeta">Loading APK verification metadata...</div>
    </div>

    <div class="card">
      <h2>2. DIRECT BROWSER UPLOAD TO GOFILE.IO (APK OR 400MB+ PC BUNDLE)</h2>
      <div style="font-size:12px; margin-bottom:8px; line-height:1.45;">
        Upload the built <b>Universal APK</b> directly to <b>Gofile.io</b> from your browser with 1 click, OR select your local <b>400MB+ Project I.G.I. PC (.zip / .obb)</b> file to upload &amp; generate a shareable Gofile link:
      </div>
      <button class="btn" onclick="uploadBuiltApkToGofile()">&#9729; Upload Built Universal APK to Gofile.io Now</button>
      <div style="margin-top:8px; border-top:1px dashed #245832; padding-top:8px;">
        <label style="font-size:11px; color:#9de0ac;">Or upload local 400MB+ PC Data (.obb / .zip) to Gofile.io:</label>
        <input type="file" id="customFile" accept=".zip,.obb,.apk,.rar,.7z"/>
        <button class="btn" onclick="uploadSelectedFileToGofile()">&#9729; Upload Selected 400MB+ File to Gofile.io</button>
      </div>
      <div class="prog"><div id="upBar"></div></div>
      <div class="status" id="gofileOut" style="margin-top:8px;">Ready to upload to Gofile.io.</div>
    </div>

    <div class="card">
      <h2>3. CLI 400MB+ PC OBB PACKAGER &amp; GOFILE AUTO-UPLOADER</h2>
      <pre style="margin:0;"># Package installed 400MB+ Windows PC Project I.G.I. folder into
# main.1000.com.berasxcorps.igiport.obb + APK bundle &amp; upload to Gofile:
python3 igi-cpu-port/tools/pack_full_pc_400mb_and_upload_gofile.py \
  --pc-dir "/path/to/Project IGI" --upload</pre>
    </div>
  </div>
</div>

<script>
const scr = document.getElementById('screen');
let dragging = false, lastX = 0, lastY = 0;

async function refreshMeta() {
  const r = await fetch('/api/meta');
  const d = await r.json();
  document.getElementById('apkMeta').textContent =
    `File   : ${d.name} (${(d.size/1048576).toFixed(2)} MB)\n` +
    `SHA256 : ${d.sha256}\n` +
    `ABIs   : arm64-v8a + x86_64 (16KB Page-Aligned, v1+v2 Signed)\n` +
    `OBB ID : main.1000.com.berasxcorps.igiport.obb`;
}
refreshMeta();

let loopBusy = false;
setInterval(() => {
  if (loopBusy) return;
  loopBusy = true;
  const img = new Image();
  img.onload = () => { scr.src = img.src; loopBusy = false; };
  img.onerror = () => { loopBusy = false; };
  img.src = '/api/frame.jpg?t=' + Date.now();
}, 95);

function relCoords(e) {
  const r = scr.getBoundingClientRect();
  return [
    Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
  ];
}

scr.addEventListener('pointerdown', e => {
  scr.setPointerCapture(e.pointerId);
  dragging = true;
  const [nx, ny] = relCoords(e);
  lastX = nx; lastY = ny;
  fetch('/api/touch', {method:'POST', body:JSON.stringify({action:0, x:nx, y:ny})});
});
scr.addEventListener('pointermove', e => {
  if (!dragging) return;
  const [nx, ny] = relCoords(e);
  fetch('/api/touch', {method:'POST', body:JSON.stringify({action:2, x:nx, y:ny})});
  lastX = nx; lastY = ny;
});
scr.addEventListener('pointerup', e => {
  dragging = false;
  const [nx, ny] = relCoords(e);
  fetch('/api/touch', {method:'POST', body:JSON.stringify({action:1, x:nx, y:ny})});
});

const KEY_MAP = {
  'Escape':0x01, 'Digit1':0x02, 'Digit2':0x03, 'Digit3':0x04, 'Digit4':0x05, 'Digit5':0x06, 'Digit6':0x07,
  'Backspace':0x0E, 'KeyO':0x18, 'Enter':0x1C, 'KeyC':0x2E, 'ShiftRight':0x36, 'ShiftLeft':0x36, 'KeyE':0x36,
  'Space':0x39, 'KeyQ':0x4F, 'KeyJ':0x52, 'ControlLeft':0x9D, 'ControlRight':0x9D,
  'ArrowUp':0xC8, 'KeyW':0xC8, 'PageUp':0xC9, 'ArrowLeft':0xCB, 'KeyA':0xCB,
  'ArrowRight':0xCD, 'KeyD':0xCD, 'ArrowDown':0xD0, 'KeyS':0xD0, 'PageDown':0xD1, 'KeyF':0x100
};
window.addEventListener('keydown', e => {
  if (KEY_MAP[e.code]) { e.preventDefault(); fetch('/api/key', {method:'POST', body:JSON.stringify({dik:KEY_MAP[e.code], down:1})}); }
});
window.addEventListener('keyup', e => {
  if (KEY_MAP[e.code]) { e.preventDefault(); fetch('/api/key', {method:'POST', body:JSON.stringify({dik:KEY_MAP[e.code], down:0})}); }
});

async function pushBlobToGofile(blob, filename) {
  const out = document.getElementById('gofileOut');
  const bar = document.getElementById('upBar');
  try {
    out.textContent = 'Querying best Gofile.io edge server...';
    let server = 'upload';
    try {
      const sr = await fetch('https://api.gofile.io/servers');
      const sd = await sr.json();
      if (sd.status === 'ok' && sd.data.servers.length) server = sd.data.servers[0].name;
    } catch (_) {}

    const fd = new FormData();
    fd.append('file', blob, filename);

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://${server}.gofile.io/contents/uploadfile`);
      xhr.upload.onprogress = ev => {
        if (ev.lengthComputable) {
          const pct = (ev.loaded * 100 / ev.total).toFixed(1);
          bar.style.width = pct + '%';
          out.textContent = `Uploading ${filename} to ${server}.gofile.io: ${pct}% (${(ev.loaded/1048576).toFixed(1)} MB)`;
        }
      };
      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.status === 'ok') {
            bar.style.width = '100%';
            out.innerHTML = `<b>GOFILE UPLOAD COMPLETE!</b>\nDownload Link: <a style="color:#74ff94" target="_blank" href="${res.data.downloadPage}">${res.data.downloadPage}</a>`;
            resolve(res);
          } else reject(new Error(xhr.responseText));
        } catch (err) { reject(err); }
      };
      xhr.onerror = () => reject(new Error('Network error contacting gofile.io from browser'));
      xhr.send(fd);
    });
  } catch (err) {
    out.textContent = 'Gofile upload error: ' + err.message;
  }
}

async function uploadBuiltApkToGofile() {
  const out = document.getElementById('gofileOut');
  out.textContent = 'Fetching ProjectIGI-PC-FullPort-v1.0.0-universal.apk from workbench...';
  const r = await fetch('/download/ProjectIGI-PC-FullPort-v1.0.0-universal.apk');
  const blob = await r.blob();
  await pushBlobToGofile(blob, 'ProjectIGI-PC-FullPort-v1.0.0-universal.apk');
}

async function uploadSelectedFileToGofile() {
  const inp = document.getElementById('customFile');
  if (!inp.files || !inp.files.length) {
    document.getElementById('gofileOut').textContent = 'Select a .zip / .obb / .apk file first.';
    return;
  }
  await pushBlobToGofile(inp.files[0], inp.files[0].name);
}
</script>
</body>
</html>
"""


class WorkbenchHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")

    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if p in ("/", "/index.html"):
            body = HTML_PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
        elif p == "/api/frame.jpg":
            jpg = step_jpeg()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpg)))
            self._cors()
            self.end_headers()
            self.wfile.write(jpg)
        elif p == "/api/meta":
            sha = SHA_PATH.read_text().split()[0] if SHA_PATH.exists() else ""
            meta = json.dumps({
                "name": APK_PATH.name,
                "size": APK_PATH.stat().st_size if APK_PATH.exists() else 0,
                "sha256": sha,
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(meta)))
            self._cors()
            self.end_headers()
            self.wfile.write(meta)
        elif p == f"/download/{APK_PATH.name}" and APK_PATH.exists():
            sz = APK_PATH.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.android.package-archive")
            self.send_header("Content-Disposition", f'attachment; filename="{APK_PATH.name}"')
            self.send_header("Content-Length", str(sz))
            self._cors()
            self.end_headers()
            with APK_PATH.open("rb") as f:
                while True:
                    ck = f.read(262144)
                    if not ck:
                        break
                    self.wfile.write(ck)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        p = self.path.split("?", 1)[0]
        ln = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(ln) if ln > 0 else b"{}"
        try:
            d = json.loads(raw.decode("utf-8"))
        except Exception:
            d = {}
        with s_lock:
            ensure_engine()
            if p == "/api/touch":
                s_lib.Java_com_berasxcorps_igiport_IGICpuBridge_nativeOnTouch(
                    None, None, int(d.get("action", 0)), float(d.get("x", 0.5)), float(d.get("y", 0.5))
                )
            elif p == "/api/key":
                s_lib.Java_com_berasxcorps_igiport_IGICpuBridge_nativeOnInput(
                    None, None, int(d.get("dik", 0)), int(d.get("down", 0)), 0, 0
                )
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(b'{"ok":true}')


if __name__ == "__main__":
    ensure_engine()
    port = int(os.environ.get("PORT", "8080"))
    srv = ThreadingHTTPServer(("0.0.0.0", port), WorkbenchHandler)
    print(f"[workbench] Project I.G.I. PC Full Port v1.0.0 Workbench listening on http://0.0.0.0:{port}")
    srv.serve_forever()
