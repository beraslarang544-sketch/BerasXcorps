# Project I.G.I.: I'm Going In (2000) — Reverse Engineering & Asset Inspection Report

## 1. Retail Executable (`IGI.exe`) Binary Analysis
- **SHA-256:** `8efc6c036ed6fc065a2dd18cd2c86a4f3040781a3380bc7c7781bc4b27fc971b`
- **MD5:** `6a015de0dd1c4247874c10c28a4eb350`
- **File Size:** `1,384,448` bytes (1.32 MiB)
- **Compile Timestamp (UTC):** `2000-11-23T19:49:26+00:00`
- **Architecture / Format:** `0x014C (Intel i386 32-bit x86)` / `0x010B (PE32)`
- **Image Base / Entry Point:** `0x00400000` / `0x004A50F5`
- **Static Recompilation Coverage:** **5,712 x86 functions** recovered into 39 C11 translation units (`4,259` integer, `1,453` x87 FPU)

### PE32 Sections
| Section | Virtual Address | Virtual Size | Raw Offset | Raw Size | Flags |
|---|---:|---:|---:|---:|---:|
| `.text` | `0x00401000` | `1,250,576` | `0x1000` | `1,253,376` | `0x60000020` |
| `.rdata` | `0x00533000` | `10,486` | `0x133000` | `12,288` | `0x40000040` |
| `.data` | `0x00536000` | `7,325,016` | `0x136000` | `106,496` | `0xC0000040` |
| `.rsrc` | `0x00C33000` | `7,744` | `0x150000` | `8,192` | `0x40000040` |

### Imported System & DirectX7 Libraries
| DLL | Symbol Count | Key Imported APIs |
|---|---:|---|
| `KERNEL32.dll` | 64 | `FreeEnvironmentStringsW, WideCharToMultiByte, FreeEnvironmentStringsA, GetEnvironmentStrings, GetEnvironmentStringsW, SetHandleCount` |
| `USER32.dll` | 30 | `AdjustWindowRect, InvalidateRect, GetClientRect, ClientToScreen, SetFocus, SetWindowPos` |
| `GDI32.dll` | 3 | `GetDeviceCaps, CreateICA, DeleteDC` |
| `ole32.dll` | 3 | `CoCreateInstance, CoInitialize, CoUninitialize` |
| `WINMM.dll` | 9 | `mixerGetLineControlsA, mixerSetControlDetails, mixerClose, mixerGetNumDevs, mixerOpen, mixerGetDevCapsA` |
| `DINPUT.dll` | 2 | `DirectInputCreateA, DirectInputCreateEx` |
| `DSOUND.dll` | 1 | `ord#1` |
| `DDRAW.dll` | 2 | `DirectDrawEnumerateExA, DirectDrawCreateEx` |
| `AVIFIL32.dll` | 10 | `AVIFileGetStream, AVIStreamInfoA, AVIFileInfoA, AVIStreamRelease, AVIStreamRead, AVIFileOpenA` |
| `MSVFW32.dll` | 4 | `ICLocate, ICSendMessage, ICClose, ICDecompress` |

### Innerloop Studios Source Paths Recovered from Binary Asserts
```text
```

## 2. Proprietary File Formats Inspected & Verified
- **`ILFF` / `IRES` (`*.res`):** 20-byte header (`ILFF` + total_size + align + `0` + `IRES`) followed by 16-byte aligned `NAME` + payload chunk pairs. Round-trip verified on `qed_bundle.res`.
- **`LOOP` v8.5 (`*.qvm` / `*.qsc`):** Stack-based virtual machine (interpreter at `0x004BCFD0`, 49 opcodes at `0x004BECB0`). Decompiled `qedconfig.qvm` (161 ops) & `qedkeybindings.qvm` (705 ops), and compiled Mission 1 `objects.qsc` -> `objects.qvm` (**44,244 instructions**, 893 strings).
- **`LOOP` Texture/Sprite (`*.tex` v9/v11, `*.spr` v9):** Decoded `sky_layer1.tex` (64x64 ARGB8888), `sky_layer2.tex`, `level1/terrain/terrain.tex` (18x 128x128 RGB565 surface tiles), and QED sprites to PNG.
- **Fractal Octree Terrain (`*.ctr`, `*.cmd`, `*.hmp`, `*.lmp`, `*.bit`):** Right-handed world (`4096 units = 1.0 m`), 11,022 directed-acyclic octree nodes in `level1/terrain.ctr` with D4 symmetry flags `0..7` and 268 baked lightmap patches in `terrain.lmp`.

## 3. Mission 01 (`level1` — Trainyard) Scene Graph Summary
- **Total Scripted Tasks:** `1,165`
| Task Class | Count |
|---|---:|
| `EditRigidObj` | 339 |
| `TerrainLightMap` | 266 |
| `PatrolPathCommand` | 104 |
| `EditCamera` | 43 |
| `PatrolPath` | 37 |
| `Container` | 29 |
| `HumanAI` | 26 |
| `HumanSoldier` | 25 |
| `Building` | 24 |
| `StatusMessage` | 23 |
| `Door` | 22 |
| `AmbientArea` | 20 |
| `SplineObjWaypoint` | 19 |
| `ConditionalSound` | 19 |
| `Gun` | 18 |
| `LightmapInfo` | 17 |
| `ComputerHilight` | 16 |
| `Train` | 14 |
| `TextureModifier` | 8 |
| `ConditionalContainer` | 8 |
