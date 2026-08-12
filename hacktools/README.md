# BerasXcorps HEX

Studio first-party untuk **APK dan proses milikmu**. Alurnya mirip Game Guardian yang disederhanakan — scan, refine, freeze, tabel — tapi lebih ketat dan lebih akurat: tipe aligned, epsilon float, group scan, dan parse save. Inject **tanpa decompile**. Virtual Space adalah **host sidecar**, bukan Parallel Space / VirtualApp.

HEX menolak attach proses orang lain, Frida/ptrace, Xposed, exploit root, dan perluasan blast WhatsApp.

## Jalankan

```bash
# dari akar repo
npm run hex:install
npm run hex

# atau
./scripts/hex
```

Buka [http://localhost:8787](http://localhost:8787) (bind `0.0.0.0`, port `8787`). Preview / PWA memakai origin yang sama — tidak ada Helmet CSP yang memblokir iframe.

Variabel: `HEX_HOST` (default `0.0.0.0`), `HEX_PORT` (default `8787`).

## Uji

```bash
npm run hex:test
# atau
npm test --prefix hacktools
```

Selftest memverifikasi encode AXML (string di-intern **sebelum** string pool), parse sample BerasFarm, scanner `prevBuffer` pada TypedArray yang di-slice, inject ZIP, dan parse save JSON/XML.

## Yang bisa kamu lakukan

| Modul | Fungsi |
| --- | --- |
| **Farm Lab** | Simulasi `id.berasxcorps.farm` — dump 8 KB, tanam/panen, freeze, speed |
| **Memory Lab** | Scan dump milikmu: i8–f64, unknown/changed, group, UTF-8, save JSON/XML, diff |
| **APK Inject** | Buka APK sebagai ZIP, sisipkan `assets/xcorps/*`, buang META-INF signing |
| **V-Space** | Unduh proyek Kotlin host (`id.berasxcorps.hex.vspace`) + overlay + profil |
| **Bridge** | WebSocket `/bridge` + broadcast `id.berasxcorps.hex.BRIDGE` |
| **Unduh** | ZIP webapp, SDK, studio penuh, sample APK, `hex-sign.sh`, pasang PWA |

Centang **pernyataan kepemilikan** sebelum scan / inject / pack. Server juga menolak inject tanpa `ownership: true`.

## Akurasi vs scan buta

- Alignment default = ukuran tipe (bukan setiap byte).
- Float/double memakai epsilon (bukan `===`).
- Refine memakai daftar hit sebelumnya.
- Group scan: beberapa field berelatif offset (mis. gold + beras).
- Save-file: JSON, XML, atau `key=value` — tanpa attach proses.
- Dump hex + diff dua buffer.

Nilai *live* hanya lewat SDK first-party di dalam app-mu, bukan ptrace.

## Inject tanpa decompile

Metode: ZIP + AXML. `classes.dex` / smali / `resources.arsc` **tidak disentuh**.

Yang ditulis:

- `assets/xcorps/manifest.json`
- `assets/xcorps/cheats.json`
- `assets/xcorps/schema.json`
- `assets/xcorps/vspace.json`
- `assets/xcorps/bridge.json`
- `assets/xcorps/README.txt`
- `META-INF/XCORPS.STAMP`

Tanda tangan lama di `META-INF/*.RSA|DSA|EC|SF|MF` dilepas. Sign ulang dengan kunci rilis **yang sama**:

```bash
hacktools/scripts/hex-sign.sh app-hex-unsigned.apk app-signed.apk
# atau unduh /api/download/sign-script
```

Tanpa `XCorpsRuntime` di source app-mu, folder `assets/xcorps` hanya data inert.

## Virtual Space

Bukan VirtualApp. HEX merakit host Android yang:

1. Meluncurkan **paket milikmu** lewat intent.
2. Menyimpan profil terisolasi di storage host.
3. Overlay + broadcast ke SDK.

Paket host: `id.berasxcorps.hex.vspace`.

## SDK

Salin `hacktools/sdk/XCorpsRuntime.kt` (atau `.java`) ke modul Android-mu:

```kotlin
XCorpsRuntime.attach(this)
XCorpsRuntime.register("gold") { farm.gold }
XCorpsRuntime.onSet { id, value -> /* tulis ke state game */ }
```

Protokol: [`sdk/PROTOCOL.md`](sdk/PROTOCOL.md).

## API

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/health` | Status engine + bendera kebijakan |
| POST | `/api/apk/analyze` | multipart `apk` → manifest ZIP+AXML |
| POST | `/api/apk/inject` | multipart `apk` + `payload` JSON (`ownership: true`) |
| POST | `/api/vspace/pack` | host ZIP; opsional APK tamu ter-inject |
| GET | `/api/sample/apk` | sample `id.berasxcorps.farm` |
| GET | `/api/download/webapp` | SPA + aset + SW |
| GET | `/api/download/sdk` | Kotlin/Java + PROTOCOL |
| GET | `/api/download/full` | studio (tanpa `node_modules`) |
| GET | `/api/download/sign-script` | `hex-sign.sh` |
| WS | `/bridge` | studio ↔ runtime |

## Kebijakan (ditolak)

- Attach proses sebarang
- Frida / ptrace ke app orang
- VirtualApp / Xposed / Magisk hide
- Decompile smali untuk patch
- Exploit root
- Perluasan blast WhatsApp

## Struktur

```
hacktools/
├── server.js
├── lib/          # axml, apk, inject, scanner, vspace, sample, pack
├── public/       # PWA SPA
├── sdk/          # runtime first-party
├── scripts/      # hex-sign.sh, selftest.mjs
└── templates/    # cheats.example.json
```

## Lisensi

Apache-2.0, sama dengan repo induk. Hanya untuk APK / proses yang kamu miliki.
