#!/usr/bin/env node
/**
 * HEX first-party selftest — AXML intern-before-pool, sample APK, scanner slice, inject ZIP.
 */
import { encodeAxml, parseAxml, el, aStr, androidStr, androidInt, androidBool } from "../lib/axml.js";
import { analyzeApk } from "../lib/apk.js";
import { injectAssets } from "../lib/inject.js";
import { buildSampleApk } from "../lib/sample-apk.js";
import { scanBuffer, groupScan, parseSaveFile, diffBuffers } from "../lib/scanner.js";

let failed = 0;
let passed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log("  ok  " + msg);
  } else {
    failed += 1;
    console.error("  FAIL  " + msg);
  }
}

function assertEq(actual, expected, msg) {
  const ok = Object.is(actual, expected) || actual === expected;
  if (ok) {
    passed += 1;
    console.log("  ok  " + msg);
  } else {
    failed += 1;
    console.error(`  FAIL  ${msg}  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

console.log("AXML intern-before-pool + sample BerasFarm");
{
  const tree = el(
    "manifest",
    [
      aStr("package", "id.berasxcorps.farm"),
      androidInt("versionCode", 100),
      androidStr("versionName", "1.0.0-hex"),
      androidInt("compileSdkVersion", 34),
      androidStr("compileSdkVersionCodename", "14"),
    ],
    [
      el("uses-sdk", [androidInt("minSdkVersion", 24), androidInt("targetSdkVersion", 34)]),
      el("uses-permission", [androidStr("name", "android.permission.INTERNET")]),
      el(
        "application",
        [
          androidStr("name", "id.berasxcorps.farm.FarmApp"),
          androidStr("label", "BerasFarm"),
          androidBool("debuggable", true),
          androidBool("extractNativeLibs", false),
        ],
        [
          el("activity", [
            androidStr("name", "id.berasxcorps.farm.MainActivity"),
            androidBool("exported", true),
          ]),
          el("service", [
            androidStr("name", "id.berasxcorps.hex.BridgeService"),
            androidBool("exported", false),
          ]),
          el("provider", [
            androidStr("name", "id.berasxcorps.farm.FarmProvider"),
            androidBool("grantUriPermissions", true),
            androidStr("authorities", "id.berasxcorps.farm.files"),
          ]),
        ]
      ),
    ]
  );
  const buf = encodeAxml(tree);
  assert(buf.length > 64, "encodeAxml menghasilkan buffer");
  assertEq(buf.readUInt16LE(0), 0x0003, "magic RES_XML_TYPE");
  const m = parseAxml(buf);
  assertEq(m.package, "id.berasxcorps.farm", "package ter-intern sebelum string pool");
  assertEq(m.versionName, "1.0.0-hex", "versionName string");
  assertEq(m.versionCode, 100, "versionCode 0x0101021b (bukan grantUriPermissions)");
  assertEq(m.minSdkVersion, 24, "minSdkVersion");
  assertEq(m.targetSdkVersion, 34, "targetSdkVersion");
  assertEq(m.compileSdkVersion, 34, "compileSdkVersion 0x01010572");
  assertEq(m.application.label, "BerasFarm", "application.label");
  assertEq(m.application.name, "id.berasxcorps.farm.FarmApp", "application.name");
  assertEq(m.application.debuggable, true, "debuggable");
  assertEq(m.activities[0]?.name, "id.berasxcorps.farm.MainActivity", "activity");
  assertEq(m.services[0]?.name, "id.berasxcorps.hex.BridgeService", "service");
  assertEq(m.providers[0]?.name, "id.berasxcorps.farm.FarmProvider", "provider");
  assertEq(m.permissions[0], "android.permission.INTERNET", "uses-permission");
}

console.log("AXML grantUriPermissions ≠ versionCode + UTF-16 long + chunk bounds");
{
  const m = parseAxml(
    encodeAxml(
      el(
        "manifest",
        [aStr("package", "id.test.grant"), androidInt("versionCode", 7), androidStr("versionName", "7.0")],
        [
          el("application", [androidBool("extractNativeLibs", false)], [
            el("provider", [androidStr("name", "P"), androidBool("grantUriPermissions", true)]),
          ]),
        ]
      )
    )
  );
  assertEq(m.package, "id.test.grant", "grant fixture package");
  assertEq(m.versionCode, 7, "0x0101001b grantUriPermissions tidak menimpa versionCode");
  assertEq(m.providers[0]?.name, "P", "provider name");

  const long = "x".repeat(0x8000);
  const longM = parseAxml(encodeAxml(el("manifest", [aStr("package", long)], [])));
  assertEq(longM.package.length, 0x8000, "UTF-16 high-bit length (0x8000 chars)");
  assertEq(longM.package, long, "UTF-16 long entry isi utuh");

  const tiny = Buffer.alloc(16);
  tiny.writeUInt16LE(0x0003, 0);
  tiny.writeUInt16LE(8, 2);
  tiny.writeUInt32LE(16, 4);
  const empty = parseAxml(tiny);
  assertEq(empty.package, "", "chunk size bounds: buffer pendek tidak throw");

  let threw = false;
  try {
    parseAxml(Buffer.from([0, 1, 2, 3]));
  } catch {
    threw = true;
  }
  assert(threw, "buffer < 8 byte ditolak");
}

console.log("Sample APK analyze + inject ZIP");
{
  const apk = await buildSampleApk();
  const info = await analyzeApk(apk, "BerasFarm-hex-sample.apk");
  assertEq(info.package, "id.berasxcorps.farm", "analyze package");
  assertEq(info.versionName, "1.0.0-hex", "analyze versionName");
  assertEq(info.versionCode, 100, "analyze versionCode");
  assertEq(info.minSdk, 24, "analyze minSdk");
  assertEq(info.targetSdk, 34, "analyze targetSdk");
  assertEq(info.application?.label, "BerasFarm", "analyze label");
  assertEq(info.application?.name, "id.berasxcorps.farm.FarmApp", "analyze app name");
  assert(info.activities.some((a) => a.name.endsWith("MainActivity")), "analyze MainActivity");
  assert(info.services.some((s) => s.name.endsWith("BridgeService")), "analyze BridgeService");
  assertEq(info.method, "zip+axml", "method zip+axml");
  assertEq(info.decompile, false, "tidak decompile");
  assert(info.hasXcorps, "sample sudah punya assets/xcorps");
  assert(info.abis.some((a) => a.id === "arm64-v8a"), "ABI arm64");
  assertEq(info.manifest.compileSdkVersion, 34, "manifest.compileSdkVersion");

  const inj = await injectAssets(apk, {
    ownership: true,
    package: info.package,
    cheats: [{ id: "gold", type: "i32", offset: 0x1000, value: 9999 }],
    extraFiles: {
      "assets/xcorps/extra.txt": "ok",
      "classes.dex": "should-not-write",
    },
  });
  assertEq(inj.decompiled, false, "inject tidak decompile");
  assert(inj.added.includes("assets/xcorps/manifest.json"), "inject manifest");
  assert(inj.added.includes("assets/xcorps/extra.txt"), "extraFiles di assets/xcorps");
  assert(!inj.added.includes("classes.dex"), "extraFiles di luar xcorps ditolak");
  assert(inj.removed.some((p) => /MANIFEST\.MF$/i.test(p)), "signature META-INF dilepas");

  const after = await analyzeApk(inj.buffer, "injected.apk");
  assertEq(after.package, "id.berasxcorps.farm", "package tetap setelah inject");
  assert(after.hasXcorps, "hasXcorps setelah inject");
  assert(Array.isArray(after.existingCheats) && after.existingCheats[0]?.id === "gold", "cheats.json terbaca");
}

console.log("Scanner prevBuffer slice + group + save + diff");
{
  const backing = new ArrayBuffer(32);
  const prevFull = new Uint8Array(backing);
  prevFull.set([10, 0, 0, 0, 99, 0, 0, 0], 8);
  const prevSlice = new Uint8Array(backing, 8, 8);
  const curr = new Uint8Array([10, 0, 0, 0, 20, 0, 0, 0]);

  const changed = scanBuffer({
    buffer: curr,
    prevBuffer: prevSlice,
    type: "i32",
    compare: "changed",
    aligned: true,
  });
  assertEq(changed.count, 1, "changed hanya 1 slot (prevBuffer pakai byteOffset)");
  assertEq(changed.offsets[0], 4, "changed offset 4 (99→20)");

  const unchanged = scanBuffer({
    buffer: curr,
    prevBuffer: prevSlice,
    type: "i32",
    compare: "unchanged",
    aligned: true,
  });
  assertEq(unchanged.count, 1, "unchanged offset 0 (nilai 10)");
  assertEq(unchanged.offsets[0], 0, "unchanged di 0");

  const eq = scanBuffer({ buffer: curr, type: "i32", compare: "eq", value: 20, aligned: true });
  assertEq(eq.count, 1, "eq 20");
  assertEq(eq.offsets[0], 4, "eq offset 4");

  const fbuf = new ArrayBuffer(16);
  new DataView(fbuf).setFloat32(4, 1.5, true);
  const fl = scanBuffer({ buffer: fbuf, type: "f32", compare: "eq", value: 1.501, epsilon: 0.01, aligned: false });
  assert(fl.count >= 1, "float epsilon 0.01");

  const gbuf = new ArrayBuffer(64);
  const gv = new DataView(gbuf);
  gv.setInt32(16, 100, true);
  gv.setInt32(24, 50, true);
  const grp = groupScan(
    gbuf,
    [
      { offset: 0, type: "i32", value: 100 },
      { offset: 8, type: "i32", value: 50 },
    ],
    { start: 16, end: 32, aligned: true }
  );
  assertEq(grp.count, 1, "group scan gold+beras");
  assertEq(grp.hits[0]?.offset, 16, "group base 16");

  const js = parseSaveFile(JSON.stringify({ farm: { gold: 120, rice: 3.5 } }), "save.json");
  assertEq(js.kind, "json", "parseSave json");
  assert(
    js.entries.some((e) => e.path === "farm.gold" && e.value === 120),
    "flatten farm.gold"
  );

  const xml = parseSaveFile('<save><gold>88</gold><name nick="a">b</name></save>', "save.xml");
  assertEq(xml.kind, "xml", "parseSave xml");
  assert(
    xml.entries.some((e) => e.path === "gold" && e.value === 88),
    "xml gold"
  );

  const d = diffBuffers(new Uint8Array([1, 2, 3]), new Uint8Array([1, 9, 3]));
  assertEq(d.count, 1, "diffBuffers satu byte");
  assertEq(d.diffs[0]?.offset, 1, "diff offset 1");
}

if (failed) {
  console.error(`\nHEX selftest: ${passed} ok, ${failed} gagal`);
  process.exit(1);
}
console.log(`\nHEX selftest: ${passed} ok`);
