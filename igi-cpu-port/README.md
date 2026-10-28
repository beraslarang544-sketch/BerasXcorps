# Project I.G.I.: I'm Going In — Full Original-Extracted-Size Universal Android APK (`v2.1.0`, `504.82 MB`)

Port Android **1:1 Original Extracted Size (`504.82 MB` / `529,346,011` bytes)** dari **Project I.G.I.: I'm Going In (Innerloop Studios / Eidos Interactive, 2000)** yang menyematkan **seluruh `1.956` berkas hasil ekstraksi PC retail asli (`510,205,921` bytes / `486.57 MB`) secara langsung di dalam `assets/pc/*` menggunakan `ZIP_STORED` (`0%` kompresi, ukuran byte identik 1:1 dengan file ekstrak PC asli)** tanpa bungkus `.pak` terkompresi dan tanpa perlu file OBB eksternal!

![Project I.G.I. Full Original-Extracted-Size v2.1.0 Showcase](docs/android_v200_fullsize_pc_parity.png)

---

## Ringkasan Deliverable Utama (`v2.1.0-pc-fullextracted`)

| Komponen | Spesifikasi |
|---|---|
| **Full Extracted APK (`v2.1.0`)** | `releases_full/ProjectIGI-PC-FullExtracted-v2.1.0-universal.apk` (**`529,346,011` bytes / `504.82 MB`**) |
| **SHA-256 (`v2.1.0`)** | `1bff13a80e955a45004db214443bb55aa47d7c922fb587a9f05639035cb4249d` |
| **File Ekstrak PC Asli di APK** | Langsung di `assets/pc/*` — **`1.956` file PC asli = `510,205,921` bytes (`486.57 MB`)**, `ZIP_STORED` (`comp=0`, `0%` penyusutan kompresi, 4-byte aligned) |
| **Termasuk Aset Uncut Penuh** | `assets/pc/IGI.exe` (`1,384,448` B US v1.0), `assets/pc/menusystem/SOUND/sounds.res` (`6,791,078` B uncut), `m1_music.wav` (`3,196,315` B), 6 Bahasa, & seluruh **14 Misi Kampanye PC (`level1`–`level14`)** |
| **Slim Launcher APK (`v1.0.0`)** | [`releases/ProjectIGI-PC-FullPort-v1.0.0-universal.apk`](releases/ProjectIGI-PC-FullPort-v1.0.0-universal.apk) (`18,643,147` bytes / `17.78 MB`) |
| **Package & Version** | `com.berasxcorps.igiport` (`versionName=2.1.0-pc-fullextracted`, `versionCode=2100`, label `"Project I.G.I."`) |
| **Arsitektur Native** | Universal `arm64-v8a` (`9.12 MB`) + `x86_64` (`9.48 MB`), **16 KB Page-Aligned** (Android 7.0 API 24 s/d Android 15) |
| **Tanda Tangan Kriptografi** | Dual **APK Signature Scheme v1 (JAR PKCS#7)** + **v2 (APK Sig Block 42 RSA-2048 SHA-256)** |

---

## Keunggulan Struktur `assets/pc/*` Ukuran Ekstrak Asli (`0%` Kompresi)

1. **Ukuran Asli 1:1 dari File Ekstrak PC (`510,205,921` Bytes File Game + `18.60 MB` Native `.so` = `529,346,011` Bytes / `504.82 MB`)**:
   - Seluruh `1.956` file hasil ekstraksi folder instalasi *Project I.G.I.* PC disimpan utuh menggunakan `ZIP_STORED` (`compress_size == file_size`, 4-byte aligned) langsung di pohon direktori `assets/pc/...` di dalam APK (terlihat langsung saat dibuka di ZArchiver / MT Manager / 7-Zip / APK Analyzer).
2. **Kecepatan Instalasi First-Boot Tanpa Beban Dekompresi CPU (`extract_apk_direct_pc_tree_fd`)**:
   - Karena seluruh file `assets/pc/*` disimpan tanpa kompresi (`method == 0`), peluncuran pertama menyalin langsung blok mentah `256 KB` (`pread` &rarr; `write`) tanpa beban `zlib inflate` (**terverifikasi `0,40` detik** di host Linux untuk mengekstrak seluruh `1.956` file = `510,205,921` bytes + marker CD `.AFP` dan mem-boot `IGI.exe`!).
3. **100% Keaslian Visual & Audio PC (`IGI.exe` v1.0)**:
   - **Direct3D 7 + DirectDraw 7 (`640x480`)**: Filtering tekstur bilinear `2x2` (`D3DTFG_LINEAR`), combiner `D3DTA_TFACTOR` (`rs[60]`) langit senja biru-kelabu & ikon senjata HUD hijau, font tajam `+0.5f` `TLVERTEX`, kabut atmosferik `rv->spec >> 24`, dan pagar kawat color-key `rs[41]`.
   - **DirectSound 7 3D Spatial Stereo (`44.1 kHz` OpenSL ES)**: Musik menu penuh `6.79 MB` `sounds.res` + `m1_music.wav`, dialog suara Anya, langkah kaki, dan tembakan berperedam `MP5 SD3`.
   - **Kontrol Sentuh Bebas Halangan**: Tombol `[HUD]` untuk mode layar murni PC, `[SKIP >>]` pada cutscene Anya, dan `[EXIT MAP]` pada Simotec Satellite Map Computer.
