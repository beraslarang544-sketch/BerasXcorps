#!/usr/bin/env bash
# Sign ulang APK unsigned hasil inject HEX dengan kunci rilis milikmu.
set -euo pipefail
APK="${1:-hex-unsigned.apk}"
OUT="${2:-hex-signed.apk}"
KS="${HEX_KEYSTORE:-hex-debug.jks}"
ALIAS="${HEX_KEY_ALIAS:-hex}"
PASS="${HEX_KEY_PASS:-hexdebug}"

if [[ ! -f "$KS" ]]; then
  keytool -genkeypair -v -keystore "$KS" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" \
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
  echo "Install Android build-tools (apksigner) atau JDK jarsigner."
  exit 1
fi
