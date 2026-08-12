import JSZip from "jszip";
import {
  encodeAxml,
  el,
  aStr,
  androidStr,
  androidInt,
  androidBool,
} from "./axml.js";

const PKG = "com.reexzyinject.re.com";
const VERSION = "1.0.1";

function dexStub() {
  const buf = Buffer.alloc(0x70);
  buf.write("dex\n035\0", 0, 8, "binary");
  buf.writeUInt32LE(0x70, 32);
  buf.writeUInt32LE(0x70, 36);
  buf.writeUInt32LE(0x12345678, 40);
  buf.writeUInt32LE(0, 96);
  return buf;
}

function elfStub(machine = 183) {
  const buf = Buffer.alloc(64, 0);
  buf[0] = 0x7f;
  buf.write("ELF", 1, 3, "ascii");
  buf[4] = machine === 40 || machine === 3 ? 1 : 2;
  buf[5] = 1;
  buf[6] = 1;
  buf.writeUInt16LE(3, 16);
  buf.writeUInt16LE(machine, 18);
  buf.writeUInt32LE(1, 20);
  return buf;
}

export async function buildReexzyApk({ webAssets = {} } = {}) {
  const manifest = encodeAxml(
    el(
      "manifest",
      [
        aStr("package", PKG),
        androidInt("versionCode", 101),
        androidStr("versionName", VERSION),
        androidInt("compileSdkVersion", 34),
        androidStr("compileSdkVersionCodename", "14"),
      ],
      [
        el("uses-sdk", [androidInt("minSdkVersion", 24), androidInt("targetSdkVersion", 34)]),
        el("uses-permission", [androidStr("name", "android.permission.INTERNET")]),
        el("uses-permission", [androidStr("name", "android.permission.VIBRATE")]),
        el("uses-permission", [androidStr("name", "android.permission.POST_NOTIFICATIONS")]),
        el(
          "application",
          [
            androidStr("name", `${PKG}.ReexzyApp`),
            androidStr("label", "ReexzyINJ"),
            androidBool("debuggable", false),
            androidBool("allowBackup", true),
            androidBool("hardwareAccelerated", true),
            androidBool("extractNativeLibs", false),
            androidStr("theme", "@android:style/Theme.DeviceDefault.NoActionBar"),
          ],
          [
            el("activity", [
              androidStr("name", `${PKG}.MainActivity`),
              androidStr("label", "ReexzyINJ"),
              androidBool("exported", true),
              androidStr("launchMode", "singleTask"),
            ]),
            el("receiver", [
              androidStr("name", `${PKG}.BridgeReceiver`),
              androidBool("exported", false),
            ]),
            el("service", [
              androidStr("name", `${PKG}.BroadcastService`),
              androidBool("exported", false),
            ]),
          ]
        ),
      ]
    )
  );

  const zip = new JSZip();
  zip.file("AndroidManifest.xml", manifest);
  zip.file("classes.dex", dexStub());
  zip.file("lib/arm64-v8a/libreexzy.so", elfStub(183));
  zip.file("lib/armeabi-v7a/libreexzy.so", elfStub(40));

  const stamp = {
    product: "ReexzyINJ",
    package: PKG,
    version: VERSION,
    versionCode: 101,
    ownerLogin: {
      username: "reexzyown",
      note: "Password own123 is valid ONLY on v1.0.1 and is void on later versions.",
    },
    policy: "first-party-only",
    builtAt: new Date().toISOString(),
  };
  zip.file("assets/reexzy/stamp.json", JSON.stringify(stamp, null, 2));
  zip.file(
    "assets/reexzy/README.txt",
    `ReexzyINJ ${VERSION}\nPackage: ${PKG}\nOwner session (this build only): reexzyown\nNext versions expire that credential.\nFirst-party inject studio. Not for third-party process attach.\n`
  );

  for (const [name, content] of Object.entries(webAssets)) {
    zip.file(`assets/www/${name.replace(/^\/+/, "")}`, content);
  }

  zip.file(
    "META-INF/MANIFEST.MF",
    "Manifest-Version: 1.0\nCreated-By: ReexzyINJ 1.0.1\n"
  );
  zip.file("META-INF/REEXZY.STAMP", `ReexzyINJ/${VERSION}\n${PKG}\n`);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export const REEXZY_META = { PKG, VERSION };
