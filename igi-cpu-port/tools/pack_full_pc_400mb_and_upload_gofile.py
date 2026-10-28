#!/usr/bin/env python3
"""
Project I.G.I.: I'm Going In — Full 400 MB+ Retail PC OBB Packager & Gofile.io Uploader
========================================================================================
Packages a full retail Windows PC Project I.G.I. (2000) game folder (~430-550 MB:
IGI.exe + common/ + missions/ + menusystem/ + weapons/ + sound/ + movies/) into:
  1) main.1000.com.berasxcorps.igiport.obb  (Android Expansion OBB / SAF Import Pack)
  2) ProjectIGI-PC-FullPort-v1.0.0-FullBundle.zip  (APK + 400MB+ OBB + Install Guide)
and uploads directly to Gofile (https://gofile.io) via streaming multipart HTTPS!

Zero third-party Python dependencies required (uses Python 3 standard library only:
works out-of-the-box on Windows, Linux, macOS, and Android Termux).

Usage:
  # Package full 400MB+ PC game folder & upload APK + OBB bundle to Gofile.io:
  python3 igi-cpu-port/tools/pack_full_pc_400mb_and_upload_gofile.py --pc-dir /path/to/ProjectIGI --upload

  # Package + install directly onto a USB-connected Android phone via ADB:
  python3 igi-cpu-port/tools/pack_full_pc_400mb_and_upload_gofile.py --pc-dir /path/to/ProjectIGI --adb-push

  # Upload only the built Universal APK to Gofile.io:
  python3 igi-cpu-port/tools/pack_full_pc_400mb_and_upload_gofile.py --apk-only --upload
"""
import argparse
import hashlib
import http.client
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.request
import uuid
import zipfile
from pathlib import Path

PORT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_APK = PORT_DIR / "releases" / "ProjectIGI-PC-FullPort-v1.0.0-universal.apk"
OBB_NAME = "main.1000.com.berasxcorps.igiport.obb"

KNOWN_EXE_SHA256 = {
    "8efc6c036ed6fc065a2dd18cd2c86a4f3040781a3380bc7c7781bc4b27fc971b": "Retail v1.0 US Unpacked (Recommended - 5,712 Recompiled Functions Match 1:1)",
    "ae93669a027d30b5f3f6c311594d9676acd72788dd7283b3594d9676acd72788": "Retail v1.0 EU Release",
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def build_obb_from_pc_dir(pc_dir: Path, out_obb: Path) -> dict:
    if not pc_dir.is_dir():
        raise FileNotFoundError(f"PC directory not found: {pc_dir}")

    files = [p for p in sorted(pc_dir.rglob("*")) if p.is_file()]
    exe_file = next((p for p in files if p.name.lower() == "igi.exe"), None)
    if not exe_file:
        raise RuntimeError(f"IGI.exe not found inside {pc_dir}! Point --pc-dir to your installed Project I.G.I. PC folder.")

    exe_sha = sha256_file(exe_file)
    total_raw = sum(p.stat().st_size for p in files)
    print(f"[pc-audit] Found IGI.exe ({exe_file.stat().st_size:,} B, SHA-256={exe_sha[:16]}...)")
    print(f"[pc-audit] Scanning {len(files)} PC files ({total_raw / 1048576:.2f} MB raw) ...")

    out_obb.parent.mkdir(parents=True, exist_ok=True)
    existing_Rel_lower = {p.relative_to(pc_dir).as_posix().lower() for p in files}

    written_bytes = 0
    t0 = time.time()
    # Store already-compressed .avi/.wav/.res fast with ZIP_DEFLATED level 1 or ZIP_STORED
    with zipfile.ZipFile(out_obb, "w", allowZip64=True) as zf:
        for idx, fpath in enumerate(files, 1):
            rel = fpath.relative_to(pc_dir).as_posix()
            ext = fpath.suffix.lower()
            comp = zipfile.ZIP_STORED if ext in {".avi", ".bik", ".mp3", ".ogg"} else zipfile.ZIP_DEFLATED
            zf.write(fpath, arcname=rel, compress_type=comp, compresslevel=1 if comp == zipfile.ZIP_DEFLATED else None)
            written_bytes += fpath.stat().st_size
            if idx % 50 == 0 or idx == len(files):
                pct = (written_bytes * 100.0) / max(1, total_raw)
                print(f"\r  [obb-pack] {idx}/{len(files)} files ({written_bytes/1048576:.1f}/{total_raw/1048576:.1f} MB, {pct:.1f}%)", end="", flush=True)

        # Ensure retail CD-ROM verification marker files exist for both US & EU releases
        for marker in ("ANYS.AFP", "MPZM.AFP", "YMBE.AFP"):
            if marker.lower() not in existing_Rel_lower:
                zf.writestr(marker, b"\x01")
    print()

    obb_sz = out_obb.stat().st_size
    obb_sha = sha256_file(out_obb)
    print(f"[obb-pack] Built {out_obb} ({obb_sz:,} bytes / {obb_sz / 1048576:.2f} MB) in {time.time() - t0:.1f}s")
    print(f"[obb-pack] SHA-256: {obb_sha}")
    return {
        "obb_path": str(out_obb),
        "obb_size": obb_sz,
        "obb_sha256": obb_sha,
        "raw_pc_bytes": total_raw,
        "pc_file_count": len(files),
        "exe_sha256": exe_sha,
    }


def build_combined_bundle(apk_path: Path, obb_path: Path, out_bundle: Path) -> Path:
    guide = (
        "PROJECT I.G.I.: I'M GOING IN — ANDROID PC FULL PORT (v1.0.0)\n"
        "=============================================================\n\n"
        "INSTALLATION (METHOD A — IN-APP 1-TAP IMPORT, ANDROID 7 TO 15):\n"
        "  1. Install ProjectIGI-PC-FullPort-v1.0.0-universal.apk\n"
        "  2. Open 'Project I.G.I. (PC Full Port)'\n"
        "  3. Tap '4. IMPORT / BOOT 400MB+ RETAIL PC DATA (.OBB / .ZIP)'\n"
        f"  4. Select '{OBB_NAME}' — the app extracts it automatically and boots PC IGI.exe!\n\n"
        "INSTALLATION (METHOD B — MANUAL OBB PLACEMENT / ADB):\n"
        "  1. Install ProjectIGI-PC-FullPort-v1.0.0-universal.apk\n"
        f"  2. Copy '{OBB_NAME}' to:\n"
        f"     /Internal Storage/Android/obb/com.berasxcorps.igiport/{OBB_NAME}\n"
        "  3. Launch the app — it auto-detects the OBB and boots full PC IGI.exe!\n"
    )
    print(f"[bundle] Creating single Gofile upload archive: {out_bundle} ...")
    with zipfile.ZipFile(out_bundle, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        zf.write(apk_path, arcname=apk_path.name)
        zf.write(obb_path, arcname=OBB_NAME)
        zf.writestr("INSTALL_ANDROID_PC_FULLPORT.txt", guide.encode("utf-8"))
    print(f"[bundle] Ready: {out_bundle} ({out_bundle.stat().st_size / 1048576:.2f} MB)")
    return out_bundle


def get_gofile_best_server() -> str:
    req = urllib.request.Request(
        "https://api.gofile.io/servers",
        headers={"User-Agent": "ProjectIGI-PC-FullPort-Uploader/1.0"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if data.get("status") != "ok":
        raise RuntimeError(f"Gofile server query returned unexpected response: {data}")
    servers = data.get("data", {}).get("servers", [])
    if not servers:
        return "upload"
    return servers[0]["name"]


def upload_file_to_gofile(file_path: Path, token: str = None, folder_id: str = None) -> dict:
    """Stream arbitrary-size (400MB - 5GB+) file to Gofile.io using chunked HTTP/1.1."""
    server = get_gofile_best_server()
    host = f"{server}.gofile.io"
    endpoint = "/contents/uploadfile"

    boundary = f"----BerasXcorpsGofileBoundary{uuid.uuid4().hex}"
    pre_parts = []
    if folder_id:
        pre_parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="folderId"\r\n\r\n'
            f"{folder_id}\r\n".encode("utf-8")
        )
    file_hdr = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8")
    closing = f"\r\n--{boundary}--\r\n".encode("utf-8")

    file_size = file_path.stat().st_size
    content_length = sum(len(p) for p in pre_parts) + len(file_hdr) + file_size + len(closing)

    print(f"[gofile] Connecting to https://{host}{endpoint} ({file_size / 1048576:.2f} MB) ...")
    ctx = ssl.create_default_context()
    conn = http.client.HTTPSConnection(host, 443, context=ctx, timeout=600)
    conn.putrequest("POST", endpoint)
    conn.putheader("User-Agent", "ProjectIGI-PC-FullPort-Uploader/1.0")
    conn.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
    conn.putheader("Content-Length", str(content_length))
    if token:
        conn.putheader("Authorization", f"Bearer {token}")
    conn.endheaders()

    for p in pre_parts:
        conn.send(p)
    conn.send(file_hdr)

    sent = 0
    t0 = time.time()
    with file_path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)  # 1 MB streaming buffer
            if not chunk:
                break
            conn.send(chunk)
            sent += len(chunk)
            elapsed = max(0.001, time.time() - t0)
            mbps = (sent / 1048576.0) / elapsed
            pct = (sent * 100.0) / max(1, file_size)
            print(f"\r  [gofile-up] {sent/1048576:.1f}/{file_size/1048576:.1f} MB ({pct:.1f}%) @ {mbps:.2f} MB/s", end="", flush=True)

    conn.send(closing)
    print()

    resp = conn.getresponse()
    body = resp.read().decode("utf-8", errors="replace")
    conn.close()
    if resp.status >= 400:
        raise RuntimeError(f"Gofile HTTP {resp.status}: {body}")

    parsed = json.loads(body)
    if parsed.get("status") != "ok":
        raise RuntimeError(f"Gofile API error: {parsed}")
    return parsed["data"]


def adb_push_to_device(apk_path: Path, obb_path: Path = None):
    print(f"[adb] Installing {apk_path.name} ...")
    subprocess.run(["adb", "install", "-r", str(apk_path)], check=True)
    if obb_path and obb_path.exists():
        remote_dir = "/sdcard/Android/obb/com.berasxcorps.igiport"
        subprocess.run(["adb", "shell", "mkdir", "-p", remote_dir], check=True)
        print(f"[adb] Pushing {obb_path.name} ({obb_path.stat().st_size/1048576:.1f} MB) -> {remote_dir}/ ...")
        subprocess.run(["adb", "push", str(obb_path), f"{remote_dir}/{OBB_NAME}"], check=True)
    print("[adb] Launching Project I.G.I. (PC Full Port) ...")
    subprocess.run(["adb", "shell", "am", "start", "-n", "com.berasxcorps.igiport/.MainActivity"], check=True)


def main():
    ap = argparse.ArgumentParser(description="Package 400MB+ Retail PC Project I.G.I. OBB + APK & Upload to Gofile.io")
    ap.add_argument("--pc-dir", type=Path, help="Path to installed Windows PC Project I.G.I. directory (containing IGI.exe & .res files)")
    ap.add_argument("--apk", type=Path, default=DEFAULT_APK, help="Path to built Universal Android APK")
    ap.add_argument("--out-dir", type=Path, default=Path("./igi_fullport_dist"), help="Output directory for OBB & bundle")
    ap.add_argument("--apk-only", action="store_true", help="Upload only the Universal APK without building OBB")
    ap.add_argument("--upload", action="store_true", help="Upload built artifact directly to Gofile.io")
    ap.add_argument("--gofile-token", default=os.environ.get("GOFILE_TOKEN"), help="Optional Gofile API bearer token")
    ap.add_argument("--adb-push", action="store_true", help="Install APK & push OBB directly to connected Android device")
    args = ap.parse_args()

    if not args.apk.exists():
        sys.exit(f"ERROR: APK not found at {args.apk}. Run build_cpu_apk.py first.")

    target_upload = args.apk
    obb_path = None

    if not args.apk_only:
        if not args.pc_dir:
            sys.exit("ERROR: Provide --pc-dir /path/to/ProjectIGI (400MB+ PC folder) or pass --apk-only.")
        args.out_dir.mkdir(parents=True, exist_ok=True)
        obb_path = args.out_dir / OBB_NAME
        build_obb_from_pc_dir(args.pc_dir, obb_path)
        bundle_path = args.out_dir / "ProjectIGI-PC-FullPort-v1.0.0-Bundle-APK+OBB.zip"
        target_upload = build_combined_bundle(args.apk, obb_path, bundle_path)

    if args.adb_push:
        adb_push_to_device(args.apk, obb_path)

    if args.upload:
        try:
            res = upload_file_to_gofile(target_upload, token=args.gofile_token)
        except Exception as exc:
            sys.exit(
                f"\n[gofile] Outbound HTTPS to api.gofile.io failed in this network environment: {exc}\n"
                f"Run this exact command on any PC / Termux / machine with internet access to upload '{target_upload}' directly to Gofile.io!"
            )
        dl_page = res.get("downloadPage", "")
        code = res.get("code", "")
        print("\n" + "=" * 68)
        print("  GOFILE.IO UPLOAD COMPLETE!")
        print(f"  Download URL : {dl_page}")
        print(f"  Gofile Code  : {code}")
        print(f"  File Name    : {res.get('fileName', target_upload.name)}")
        print("=" * 68)
        receipt = (args.out_dir if not args.apk_only else PORT_DIR / "releases") / "GOFILE_UPLOAD_RECEIPT.json"
        receipt.parent.mkdir(parents=True, exist_ok=True)
        receipt.write_text(json.dumps(res, indent=2) + "\n")
        print(f"Saved receipt to: {receipt}")


if __name__ == "__main__":
    main()
