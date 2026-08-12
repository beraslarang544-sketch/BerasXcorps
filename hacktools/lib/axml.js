/**
 * Binary Android XML (AXML) encoder / decoder.
 * Used to read AndroidManifest.xml from an APK without apktool/jadx.
 *
 * Encode invariant: every string that will appear in an attribute or
 * element MUST be interned before writeStringPool(). Interning after the
 * pool is written leaves raw/typed indices pointing past the pool, so
 * package / label / versionName decode as "".
 */

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_NAMESPACE_TYPE = 0x0100;
const RES_XML_END_NAMESPACE_TYPE = 0x0101;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const RES_XML_CDATA_TYPE = 0x0104;

const TYPE_NULL = 0x00;
const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

const ANDROID_NS = "http://schemas.android.com/apk/res/android";

/** Confirmed android.R.attr ids (AOSP public.xml). */
const ANDROID_ATTR = {
  0x01010000: "theme",
  0x01010001: "label",
  0x01010002: "icon",
  0x01010003: "name",
  0x01010006: "permission",
  0x0101000a: "permissionGroup",
  0x0101000c: "hasCode",
  0x0101000e: "enabled",
  0x0101000f: "debuggable",
  0x01010010: "exported",
  0x01010011: "process",
  0x01010012: "taskAffinity",
  0x01010018: "authorities",
  0x0101001b: "grantUriPermissions",
  0x0101001d: "launchMode",
  0x0101001e: "screenOrientation",
  0x0101001f: "configChanges",
  0x01010024: "value",
  0x01010025: "resource",
  0x0101020c: "minSdkVersion",
  0x0101021b: "versionCode",
  0x0101021c: "versionName",
  0x01010270: "targetSdkVersion",
  0x01010280: "allowBackup",
  0x010102d3: "hardwareAccelerated",
  0x010103f2: "banner",
  0x010104ea: "extractNativeLibs",
  0x010104ec: "usesCleartextTraffic",
  0x0101054b: "roundIcon",
  0x01010572: "compileSdkVersion",
  0x01010573: "compileSdkVersionCodename",
  0x0101057a: "appComponentFactory",
  0x0101057c: "requestLegacyExternalStorage",
};

const ATTR_IDS = Object.fromEntries(Object.entries(ANDROID_ATTR).map(([id, name]) => [name, Number(id)]));

export function encodeAxml(root) {
  const strings = [];
  const intern = (s) => {
    const v = s == null ? "" : String(s);
    let i = strings.indexOf(v);
    if (i < 0) {
      strings.push(v);
      i = strings.length - 1;
    }
    return i;
  };
  const idx = (s) => {
    const v = s == null ? "" : String(s);
    const i = strings.indexOf(v);
    if (i < 0) throw new Error("AXML: string not interned before pool: " + JSON.stringify(v));
    return i;
  };

  intern("");
  intern("android");
  intern(ANDROID_NS);

  const nodes = [];
  const walk = (el) => {
    intern(el.name);
    for (const at of el.attrs || []) {
      intern(at.name);
      if (at.ns && at.ns !== "android") intern(at.ns);
      if (at.kind === "string" || at.kind === "ref") intern(at.value);
    }
    nodes.push({ kind: "start", el });
    for (const c of el.children || []) walk(c);
    nodes.push({ kind: "end", el });
  };
  walk(root);

  let lastRes = -1;
  const resIds = strings.map((s, i) => {
    const id = ATTR_IDS[s] || 0;
    if (id) lastRes = i;
    return id;
  });
  const resMap = lastRes >= 0 ? writeResMap(resIds.slice(0, lastRes + 1)) : Buffer.alloc(0);
  const pool = writeStringPool(strings);

  const chunks = [writeNsStart(idx)];
  for (const n of nodes) {
    if (n.kind === "start") chunks.push(writeStart(n.el, idx));
    else chunks.push(writeEnd(n.el, idx));
  }
  chunks.push(writeNsEnd(idx));

  const body = Buffer.concat([pool, resMap, ...chunks]);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(RES_XML_TYPE, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

function writeStringPool(strings) {
  const count = strings.length;
  const encoded = strings.map(writeUtf16Entry);
  const offsets = Buffer.alloc(count * 4);
  let dataSize = 0;
  for (let i = 0; i < count; i++) {
    offsets.writeUInt32LE(dataSize, i * 4);
    dataSize += encoded[i].length;
  }
  const data = Buffer.concat(encoded);
  const pad = (4 - (data.length % 4)) % 4;
  const padded = pad ? Buffer.concat([data, Buffer.alloc(pad)]) : data;
  const headerSize = 28;
  const size = headerSize + offsets.length + padded.length;
  const head = Buffer.alloc(headerSize);
  head.writeUInt16LE(RES_STRING_POOL_TYPE, 0);
  head.writeUInt16LE(headerSize, 2);
  head.writeUInt32LE(size, 4);
  head.writeUInt32LE(count, 8);
  head.writeUInt32LE(0, 12); // styleCount
  head.writeUInt32LE(0, 16); // flags (UTF-16)
  head.writeUInt32LE(headerSize + offsets.length, 20);
  head.writeUInt32LE(0, 24); // stylesStart
  return Buffer.concat([head, offsets, padded]);
}

function writeUtf16Entry(s) {
  const n = s.length;
  if (n >= 0x8000) {
    const chars = Buffer.alloc(4 + n * 2 + 2);
    chars.writeUInt16LE(0x8000 | ((n >>> 16) & 0x7fff), 0);
    chars.writeUInt16LE(n & 0xffff, 2);
    for (let i = 0; i < n; i++) chars.writeUInt16LE(s.charCodeAt(i), 4 + i * 2);
    return chars;
  }
  const chars = Buffer.alloc(2 + n * 2 + 2);
  chars.writeUInt16LE(n, 0);
  for (let i = 0; i < n; i++) chars.writeUInt16LE(s.charCodeAt(i), 2 + i * 2);
  return chars;
}

function writeResMap(ids) {
  const size = 8 + ids.length * 4;
  const buf = Buffer.alloc(size);
  buf.writeUInt16LE(RES_XML_RESOURCE_MAP_TYPE, 0);
  buf.writeUInt16LE(8, 2);
  buf.writeUInt32LE(size, 4);
  for (let i = 0; i < ids.length; i++) buf.writeUInt32LE(ids[i] >>> 0, 8 + i * 4);
  return buf;
}

function writeNsStart(idx) {
  const buf = Buffer.alloc(24);
  buf.writeUInt16LE(RES_XML_START_NAMESPACE_TYPE, 0);
  buf.writeUInt16LE(16, 2);
  buf.writeUInt32LE(24, 4);
  buf.writeUInt32LE(1, 8);
  buf.writeInt32LE(-1, 12);
  buf.writeInt32LE(idx("android"), 16);
  buf.writeInt32LE(idx(ANDROID_NS), 20);
  return buf;
}

function writeNsEnd(idx) {
  const buf = Buffer.alloc(24);
  buf.writeUInt16LE(RES_XML_END_NAMESPACE_TYPE, 0);
  buf.writeUInt16LE(16, 2);
  buf.writeUInt32LE(24, 4);
  buf.writeUInt32LE(1, 8);
  buf.writeInt32LE(-1, 12);
  buf.writeInt32LE(idx("android"), 16);
  buf.writeInt32LE(idx(ANDROID_NS), 20);
  return buf;
}

function writeStart(el, idx) {
  const attrs = el.attrs || [];
  const header = 16;
  const ext = 20;
  const attrSize = 20;
  const size = header + ext + attrs.length * attrSize;
  const buf = Buffer.alloc(size);
  buf.writeUInt16LE(RES_XML_START_ELEMENT_TYPE, 0);
  buf.writeUInt16LE(header, 2);
  buf.writeUInt32LE(size, 4);
  buf.writeUInt32LE(1, 8);
  buf.writeInt32LE(-1, 12);
  buf.writeInt32LE(-1, 16);
  buf.writeInt32LE(idx(el.name), 20);
  buf.writeUInt16LE(ext, 24);
  buf.writeUInt16LE(attrSize, 26);
  buf.writeUInt16LE(attrs.length, 28);
  buf.writeUInt16LE(0, 30);
  buf.writeUInt16LE(0, 32);
  buf.writeUInt16LE(0, 34);

  let p = 36;
  for (const at of attrs) {
    const ns = at.ns === "android" ? idx(ANDROID_NS) : -1;
    buf.writeInt32LE(ns, p);
    buf.writeInt32LE(idx(at.name), p + 4);
    let raw = -1;
    let typedType = TYPE_INT_DEC;
    let typedData = 0;
    if (at.kind === "string") {
      const si = idx(at.value);
      raw = si;
      typedType = TYPE_STRING;
      typedData = si;
    } else if (at.kind === "bool") {
      typedType = TYPE_INT_BOOLEAN;
      typedData = at.value ? 0xffffffff : 0;
    } else if (at.kind === "ref") {
      typedType = TYPE_REFERENCE;
      typedData = Number(at.value) || 0;
    } else {
      typedType = TYPE_INT_DEC;
      typedData = Number(at.value) || 0;
    }
    buf.writeInt32LE(raw, p + 8);
    buf.writeUInt16LE(8, p + 12);
    buf.writeUInt8(0, p + 14);
    buf.writeUInt8(typedType, p + 15);
    buf.writeUInt32LE(typedData >>> 0, p + 16);
    p += 20;
  }
  return buf;
}

function writeEnd(el, idx) {
  const buf = Buffer.alloc(24);
  buf.writeUInt16LE(RES_XML_END_ELEMENT_TYPE, 0);
  buf.writeUInt16LE(16, 2);
  buf.writeUInt32LE(24, 4);
  buf.writeUInt32LE(1, 8);
  buf.writeInt32LE(-1, 12);
  buf.writeInt32LE(-1, 16);
  buf.writeInt32LE(idx(el.name), 20);
  return buf;
}

export function parseAxml(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8) throw new Error("AXML terlalu pendek");
  const type = buf.readUInt16LE(0);
  if (type !== RES_XML_TYPE && type !== RES_STRING_POOL_TYPE) {
    throw new Error("Bukan binary XML (magic 0x" + type.toString(16) + ")");
  }

  let strings = [];
  let resMap = [];
  const stack = [];
  let root = null;
  const nsStack = [];

  let offset = type === RES_XML_TYPE ? 8 : 0;
  while (offset + 8 <= buf.length) {
    const chunkType = buf.readUInt16LE(offset);
    const headerSize = buf.readUInt16LE(offset + 2);
    const size = buf.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > buf.length) break;

    if (chunkType === RES_STRING_POOL_TYPE) {
      strings = readStringPool(buf, offset);
    } else if (chunkType === RES_XML_RESOURCE_MAP_TYPE) {
      const n = (size - 8) / 4;
      resMap = [];
      for (let i = 0; i < n; i++) resMap.push(buf.readUInt32LE(offset + 8 + i * 4));
    } else if (chunkType === RES_XML_START_NAMESPACE_TYPE) {
      const ext = nodeExt(offset, headerSize);
      nsStack.push({
        prefix: strAt(strings, buf.readInt32LE(ext)),
        uri: strAt(strings, buf.readInt32LE(ext + 4)),
      });
    } else if (chunkType === RES_XML_END_NAMESPACE_TYPE) {
      nsStack.pop();
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      const ext = nodeExt(offset, headerSize);
      if (ext + 20 > offset + size) break;
      const nsIdx = buf.readInt32LE(ext);
      const nameIdx = buf.readInt32LE(ext + 4);
      const attrStart = buf.readUInt16LE(ext + 8);
      const attrSize = buf.readUInt16LE(ext + 10) || 20;
      const attrCount = buf.readUInt16LE(ext + 12);
      const attrs = [];
      let ap = ext + attrStart;
      for (let i = 0; i < attrCount; i++) {
        if (ap + 20 > offset + size) break;
        const aNs = buf.readInt32LE(ap);
        const aName = buf.readInt32LE(ap + 4);
        const aRaw = buf.readInt32LE(ap + 8);
        const typedType = buf.readUInt8(ap + 15);
        const typedData = buf.readUInt32LE(ap + 16);
        let key = strAt(strings, aName);
        if (!key && resMap[aName]) key = ANDROID_ATTR[resMap[aName]] || "attr_" + resMap[aName].toString(16);
        const nsUri = strAt(strings, aNs);
        const value =
          aRaw >= 0 && aRaw < strings.length ? strings[aRaw] : decodeTyped(typedType, typedData, strings);
        attrs.push({
          name: key,
          ns: nsUri,
          value,
          typedType,
          typedData,
        });
        ap += attrSize;
      }
      const node = {
        name: strAt(strings, nameIdx),
        ns: strAt(strings, nsIdx),
        attrs,
        children: [],
      };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else root = node;
      stack.push(node);
    } else if (chunkType === RES_XML_END_ELEMENT_TYPE) {
      stack.pop();
    } else if (chunkType === RES_XML_CDATA_TYPE) {
      const ext = nodeExt(offset, headerSize);
      const sIdx = buf.readInt32LE(ext);
      if (stack.length) {
        stack[stack.length - 1].children.push({
          name: "#text",
          text: strAt(strings, sIdx),
          attrs: [],
          children: [],
        });
      }
    }
    offset += size;
  }

  return summarizeManifest(root);
}

function nodeExt(offset, headerSize) {
  return offset + (headerSize >= 16 ? headerSize : 16);
}

function strAt(strings, i) {
  return i >= 0 && i < strings.length ? strings[i] : "";
}

function readStringPool(buf, offset) {
  const headerSize = buf.readUInt16LE(offset + 2);
  const stringCount = buf.readUInt32LE(offset + 8);
  const flags = buf.readUInt32LE(offset + 16);
  const stringsStart = buf.readUInt32LE(offset + 20);
  const utf8 = Boolean(flags & (1 << 8));
  const strings = [];
  for (let i = 0; i < stringCount; i++) {
    const off = buf.readUInt32LE(offset + headerSize + i * 4);
    const abs = offset + stringsStart + off;
    if (abs + 2 > buf.length) {
      strings.push("");
      continue;
    }
    if (utf8) {
      const [charSkip] = readUtf8Len(buf, abs);
      const [byteLen, lenSize] = readUtf8Len(buf, abs + charSkip);
      const start = abs + charSkip + lenSize;
      const end = Math.min(buf.length, start + byteLen);
      strings.push(buf.toString("utf8", start, end));
    } else {
      let p = abs;
      let charCount = buf.readUInt16LE(p);
      p += 2;
      if (charCount & 0x8000) {
        if (p + 2 > buf.length) {
          strings.push("");
          continue;
        }
        charCount = ((charCount & 0x7fff) << 16) | buf.readUInt16LE(p);
        p += 2;
      }
      const end = p + charCount * 2;
      if (end > buf.length) {
        strings.push("");
        continue;
      }
      strings.push(buf.toString("utf16le", p, end));
    }
  }
  return strings;
}

function readUtf8Len(buf, p) {
  if (p >= buf.length) return [0, 1];
  const b0 = buf[p];
  if (b0 & 0x80) {
    if (p + 1 >= buf.length) return [b0 & 0x7f, 1];
    return [((b0 & 0x7f) << 8) | buf[p + 1], 2];
  }
  return [b0, 1];
}

function decodeTyped(type, data, strings) {
  if (type === TYPE_STRING) return strAt(strings, data);
  if (type === TYPE_INT_BOOLEAN) return data !== 0;
  if (type === TYPE_INT_DEC || type === TYPE_INT_HEX || type === TYPE_REFERENCE || type === TYPE_NULL) return data;
  return data;
}

function attr(node, name) {
  if (!node || !Array.isArray(node.attrs)) return undefined;
  const hit = node.attrs.find((a) => a.name === name);
  return hit ? hit.value : undefined;
}

function summarizeManifest(root) {
  const emptyApp = { name: "", label: "", debuggable: false };
  if (!root) {
    return {
      package: "",
      versionName: "",
      versionCode: null,
      minSdkVersion: null,
      targetSdkVersion: null,
      compileSdkVersion: null,
      application: emptyApp,
      activities: [],
      services: [],
      receivers: [],
      providers: [],
      permissions: [],
      usesFeatures: [],
    };
  }

  const kids = Array.isArray(root.children) ? root.children : [];
  const usesSdk = kids.find((c) => c.name === "uses-sdk") || { attrs: [], children: [] };
  const app = kids.find((c) => c.name === "application") || { attrs: [], children: [] };

  const collect = (tag) =>
    (app.children || [])
      .filter((c) => c.name === tag)
      .map((c) => ({
        name: String(attr(c, "name") || ""),
        exported: Boolean(attr(c, "exported")),
        label: attr(c, "label") || "",
      }));

  const permissions = kids
    .filter((c) => c.name === "uses-permission")
    .map((c) => String(attr(c, "name") || ""))
    .filter(Boolean);

  const usesFeatures = kids
    .filter((c) => c.name === "uses-feature")
    .map((c) => ({ name: String(attr(c, "name") || ""), required: attr(c, "required") !== false }));

  return {
    package: String(attr(root, "package") || ""),
    versionName: String(attr(root, "versionName") || ""),
    versionCode: numOrNull(attr(root, "versionCode")),
    minSdkVersion: numOrNull(attr(usesSdk, "minSdkVersion")),
    targetSdkVersion: numOrNull(attr(usesSdk, "targetSdkVersion")),
    compileSdkVersion: numOrNull(attr(root, "compileSdkVersion")),
    application: {
      name: String(attr(app, "name") || ""),
      label: String(attr(app, "label") || ""),
      debuggable: Boolean(attr(app, "debuggable")),
    },
    activities: collect("activity"),
    services: collect("service"),
    receivers: collect("receiver"),
    providers: collect("provider"),
    permissions,
    usesFeatures,
  };
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function el(name, attrs = [], children = []) {
  return { name, attrs, children };
}

export function aStr(name, value) {
  return { name, kind: "string", value };
}

export function androidStr(name, value) {
  return { name, ns: "android", kind: "string", value };
}

export function androidInt(name, value) {
  return { name, ns: "android", kind: "int", value };
}

export function androidBool(name, value) {
  return { name, ns: "android", kind: "bool", value };
}
