import JSZip from "jszip";

const SIGNING_RE = /^META-INF\/.+\.(RSA|DSA|EC|SF|MF)$/i;

/**
 * Inject HEX payload into an APK as ZIP entries.
 * Does not decompile DEX / smali / resources.arsc.
 * Existing signatures are stripped so the APK can be re-signed with the owner's key.
 */
export async function injectAssets(apkBuffer, payload = {}) {
  const zip = await JSZip.loadAsync(apkBuffer);
  const removed = [];

  const doomed = [];
  zip.forEach((path) => {
    if (SIGNING_RE.test(path)) doomed.push(path);
  });
  for (const p of doomed) {
    zip.remove(p);
    removed.push(p);
  }

  const now = new Date().toISOString();
  const pack = payload.package || "unknown";
  const manifest = {
    engine: "BerasXcorps HEX",
    version: "1.0.1",
    injectedAt: now,
    package: pack,
    mode: payload.mode || "first-party",
    virtualSpace: Boolean(payload.virtualSpace),
    ownership: Boolean(payload.ownership),
    note: "Asset-level inject. classes.dex was not modified.",
  };

  const files = {
    "assets/xcorps/manifest.json": JSON.stringify(manifest, null, 2),
    "assets/xcorps/cheats.json": JSON.stringify(payload.cheats || [], null, 2),
    "assets/xcorps/schema.json": JSON.stringify(payload.schema || {}, null, 2),
    "assets/xcorps/vspace.json": JSON.stringify(
      payload.vspace || {
        enabled: true,
        isolatedStorage: true,
        overlay: true,
        speedDefault: 1,
      },
      null,
      2
    ),
    "assets/xcorps/bridge.json": JSON.stringify(
      {
        channel: "id.berasxcorps.hex.BRIDGE",
        wsPath: "/bridge",
        token: payload.bridgeToken || randomToken(),
      },
      null,
      2
    ),
    "assets/xcorps/README.txt": hexReadme(pack),
    "META-INF/XCORPS.STAMP": `HEX/${pack}/${now}\n`,
  };

  const added = [];
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
    added.push(path);
  }

  if (payload.extraFiles && typeof payload.extraFiles === "object") {
    for (const [path, content] of Object.entries(payload.extraFiles)) {
      if (!path.startsWith("assets/xcorps/")) continue;
      zip.file(path, content);
      added.push(path);
    }
  }

  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    buffer: out,
    added,
    removed,
    bytes: out.length,
    decompiled: false,
  };
}

function randomToken() {
  const a = Math.random().toString(36).slice(2, 10);
  const b = Math.random().toString(36).slice(2, 10);
  return `HEX-${a}-${b}`.toUpperCase();
}

function hexReadme(pkg) {
  return `BerasXcorps HEX — first-party runtime payload
Package : ${pkg}
Method  : ZIP asset inject (no decompile)

This folder is read by HEX SDK inside YOUR application:
  XCorpsRuntime.attach(this)

If the SDK is not compiled into this APK, these files are inert data.
They do not hook other apps, do not request root, and do not patch DEX.

Re-sign with the SAME signing key as the original release:
  apksigner sign --ks your.keystore --out signed.apk unsigned.apk

Virtual Space host can launch this package and talk to the SDK via
broadcast id.berasxcorps.hex.BRIDGE or WebSocket /bridge.
`;
}

export function signScript(apkName = "hex-unsigned.apk") {
  return `#!/usr/bin/env bash
set -euo pipefail
APK="\${1:-${apkName}}"
OUT="\${2:-hex-signed.apk}"
KS="\${HEX_KEYSTORE:-hex-debug.jks}"
ALIAS="\${HEX_KEY_ALIAS:-hex}"
PASS="\${HEX_KEY_PASS:-hexdebug}"

if [[ ! -f "$KS" ]]; then
  keytool -genkeypair -v -keystore "$KS" -alias "$ALIAS" \\
    -keyalg RSA -keysize 2048 -validity 10000 \\
    -storepass "$PASS" -keypass "$PASS" \\
    -dname "CN=BerasXcorps HEX, OU=FirstParty, O=BerasXcorps, L=Jakarta, C=ID"
fi

if command -v apksigner >/dev/null 2>&1; then
  apksigner sign --ks "$KS" --ks-key-alias "$ALIAS" --ks-pass pass:"$PASS" --out "$OUT" "$APK"
  apksigner verify "$OUT"
  echo "signed: $OUT"
elif command -v jarsigner >/dev/null 2>&1; then
  cp "$APK" "$OUT"
  jarsigner -keystore "$KS" -storepass "$PASS" -keypass "$PASS" "$OUT" "$ALIAS"
  echo "signed (v1): $OUT"
else
  echo "Install Android build-tools (apksigner) or JDK jarsigner."
  exit 1
fi
`;
}
