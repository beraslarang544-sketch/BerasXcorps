import JSZip from "jszip";
import { parseAxml } from "./axml.js";

const ABI_LABEL = {
  "armeabi-v7a": "ARMv7",
  "arm64-v8a": "ARM64",
  x86: "x86",
  x86_64: "x86_64",
  armeabi: "ARMv5",
};

export async function analyzeApk(buffer, filename = "app.apk") {
  const zip = await JSZip.loadAsync(buffer);
  const files = [];
  let uncompressed = 0;
  let compressed = 0;

  zip.forEach((path, file) => {
    if (file.dir) return;
    const size = file._data?.uncompressedSize || 0;
    const csize = file._data?.compressedSize || size;
    uncompressed += size;
    compressed += csize;
    files.push({
      path,
      size,
      compressed: csize,
      ext: extOf(path),
    });
  });

  files.sort((a, b) => b.size - a.size);

  const manifestEntry = zip.file("AndroidManifest.xml");
  if (!manifestEntry) {
    throw new Error("APK tidak valid: AndroidManifest.xml tidak ditemukan");
  }
  const manifestBuf = Buffer.from(await manifestEntry.async("uint8array"));
  const manifest = parseAxml(manifestBuf);

  const abis = [];
  const natives = [];
  const assets = [];
  const dex = [];
  let hasXcorps = false;

  for (const f of files) {
    if (f.path.startsWith("lib/")) {
      const parts = f.path.split("/");
      const abi = parts[1];
      if (abi && !abis.includes(abi)) abis.push(abi);
      natives.push(f);
    }
    if (f.path.startsWith("assets/")) assets.push(f);
    if (/^classes(\d+)?\.dex$/.test(f.path)) dex.push(f);
    if (f.path.startsWith("assets/xcorps/") || f.path === "META-INF/XCORPS.STAMP") {
      hasXcorps = true;
    }
  }

  const dexInfo = [];
  for (const d of dex) {
    const raw = Buffer.from(await zip.file(d.path).async("uint8array"));
    dexInfo.push(parseDexHeader(raw, d.path));
  }

  const elfInfo = [];
  for (const n of natives.slice(0, 12)) {
    const raw = Buffer.from(await zip.file(n.path).async("uint8array"));
    elfInfo.push({ path: n.path, ...parseElfHeader(raw), size: n.size });
  }

  let existingCheats = null;
  const cheatFile = zip.file("assets/xcorps/cheats.json");
  if (cheatFile) {
    try {
      existingCheats = JSON.parse(await cheatFile.async("string"));
    } catch {
      existingCheats = null;
    }
  }

  const permissions = [...new Set(manifest.permissions)];
  const danger = classifyPermissions(permissions);

  return {
    filename,
    size: buffer.length,
    zip: {
      files: files.length,
      uncompressed,
      compressed,
      ratio: uncompressed ? compressed / uncompressed : 1,
    },
    manifest,
    package: manifest.package,
    versionName: manifest.versionName,
    versionCode: manifest.versionCode,
    minSdk: manifest.minSdkVersion,
    targetSdk: manifest.targetSdkVersion,
    permissions,
    danger,
    components: {
      activities: manifest.activities.length,
      services: manifest.services.length,
      receivers: manifest.receivers.length,
      providers: manifest.providers.length,
    },
    activities: manifest.activities,
    services: manifest.services,
    receivers: manifest.receivers,
    providers: manifest.providers,
    application: manifest.application,
    abis: abis.map((id) => ({ id, label: ABI_LABEL[id] || id })),
    natives: natives.slice(0, 40),
    elfInfo,
    dex: dexInfo,
    assets: assets.slice(0, 80),
    topFiles: files.slice(0, 24),
    hasXcorps,
    existingCheats,
    decompile: false,
    method: "zip+axml",
  };
}

export function parseDexHeader(buf, path) {
  const magic = buf.slice(0, 8).toString("binary");
  const ok = magic.startsWith("dex\n");
  const version = ok ? buf.slice(4, 7).toString("ascii") : "";
  const fileSize = buf.length >= 36 ? buf.readUInt32LE(32) : buf.length;
  const classDefs = buf.length >= 100 ? buf.readUInt32LE(96) : null;
  return {
    path,
    valid: ok,
    version,
    fileSize,
    classDefs,
  };
}

export function parseElfHeader(buf) {
  if (buf.length < 20 || buf[0] !== 0x7f || buf[1] !== 0x45) {
    return { valid: false };
  }
  const clazz = buf[4]; // 1=32 2=64
  const data = buf[5]; // 1=LE
  const machine = buf.readUInt16LE(18);
  const map = { 3: "x86", 8: "MIPS", 40: "ARM", 62: "x86_64", 183: "AArch64" };
  return {
    valid: true,
    bits: clazz === 2 ? 64 : 32,
    le: data === 1,
    machine: map[machine] || `unk_${machine}`,
  };
}

function extOf(path) {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i + 1).toLowerCase() : "";
}

function classifyPermissions(list) {
  const high = [];
  const mid = [];
  const flags = {
    SYSTEM_ALERT_WINDOW: "overlay",
    BIND_ACCESSIBILITY_SERVICE: "a11y",
    QUERY_ALL_PACKAGES: "query-all",
    WRITE_SECURE_SETTINGS: "secure",
    REQUEST_INSTALL_PACKAGES: "install",
    PACKAGE_USAGE_STATS: "usage",
    READ_SMS: "sms",
    RECEIVE_SMS: "sms",
    READ_CONTACTS: "contacts",
    CAMERA: "camera",
    RECORD_AUDIO: "mic",
    ACCESS_FINE_LOCATION: "location",
    READ_EXTERNAL_STORAGE: "storage",
    WRITE_EXTERNAL_STORAGE: "storage",
    INTERNET: "net",
  };
  for (const p of list) {
    const short = p.split(".").pop();
    if (flags[short] && ["overlay", "a11y", "query-all", "secure", "install", "sms"].includes(flags[short])) {
      high.push(p);
    } else if (flags[short]) {
      mid.push(p);
    }
  }
  return { high, mid };
}
