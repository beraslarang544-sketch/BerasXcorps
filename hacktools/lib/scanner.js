/**
 * Typed / aligned memory scanner.
 * Accuracy first: alignment, float epsilon, group scan, save-file parse.
 */

export const TYPES = {
  i8: { size: 1, signed: true, kind: "int" },
  u8: { size: 1, signed: false, kind: "int" },
  i16: { size: 2, signed: true, kind: "int" },
  u16: { size: 2, signed: false, kind: "int" },
  i32: { size: 4, signed: true, kind: "int" },
  u32: { size: 4, signed: false, kind: "int" },
  i64: { size: 8, signed: true, kind: "int" },
  u64: { size: 8, signed: false, kind: "int" },
  f32: { size: 4, signed: true, kind: "float" },
  f64: { size: 8, signed: true, kind: "float" },
};

export function readValue(view, offset, type, le = true) {
  switch (type) {
    case "i8":
      return view.getInt8(offset);
    case "u8":
      return view.getUint8(offset);
    case "i16":
      return view.getInt16(offset, le);
    case "u16":
      return view.getUint16(offset, le);
    case "i32":
      return view.getInt32(offset, le);
    case "u32":
      return view.getUint32(offset, le);
    case "i64":
      return Number(view.getBigInt64(offset, le));
    case "u64":
      return Number(view.getBigUint64(offset, le));
    case "f32":
      return view.getFloat32(offset, le);
    case "f64":
      return view.getFloat64(offset, le);
    default:
      throw new Error("unknown type " + type);
  }
}

export function writeValue(view, offset, type, value, le = true) {
  switch (type) {
    case "i8":
      view.setInt8(offset, value);
      break;
    case "u8":
      view.setUint8(offset, value);
      break;
    case "i16":
      view.setInt16(offset, value, le);
      break;
    case "u16":
      view.setUint16(offset, value, le);
      break;
    case "i32":
      view.setInt32(offset, value, le);
      break;
    case "u32":
      view.setUint32(offset, value, le);
      break;
    case "i64":
      view.setBigInt64(offset, BigInt(value), le);
      break;
    case "u64":
      view.setBigUint64(offset, BigInt(value), le);
      break;
    case "f32":
      view.setFloat32(offset, value, le);
      break;
    case "f64":
      view.setFloat64(offset, value, le);
      break;
    default:
      throw new Error("unknown type " + type);
  }
}

function cmp(a, b, mode, extra, epsilon) {
  const close = (x, y) => Math.abs(x - y) <= epsilon;
  switch (mode) {
    case "eq":
      return close(a, b);
    case "ne":
      return !close(a, b);
    case "gt":
      return a > b;
    case "lt":
      return a < b;
    case "ge":
      return a >= b;
    case "le":
      return a <= b;
    case "range":
      return a >= extra.min && a <= extra.max;
    case "increased":
      return a > b;
    case "decreased":
      return a < b;
    case "changed":
      return !close(a, b);
    case "unchanged":
      return close(a, b);
    case "increased_by":
      return close(a - b, extra.delta);
    case "decreased_by":
      return close(b - a, extra.delta);
    default:
      return false;
  }
}

export function scanBuffer(opts) {
  const {
    buffer,
    prevBuffer = null,
    type = "i32",
    compare = "eq",
    value = 0,
    min = 0,
    max = 0,
    delta = 1,
    epsilon = 0.01,
    aligned = true,
    littleEndian = true,
    start = 0,
    end = null,
    previous = null,
    limit = 8000,
  } = opts;

  const meta = TYPES[type];
  if (!meta) throw new Error("tipe tidak dikenal: " + type);

  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let prevView = null;
  if (prevBuffer != null) {
    const pb = prevBuffer instanceof ArrayBuffer ? new Uint8Array(prevBuffer) : new Uint8Array(prevBuffer);
    prevView = new DataView(pb.buffer, pb.byteOffset, pb.byteLength);
  }

  const step = aligned ? meta.size : 1;
  const from = Math.max(0, start);
  const to = Math.min(bytes.byteLength - meta.size, end == null ? bytes.byteLength : end);
  const extra = { min: Number(min), max: Number(max), delta: Number(delta) };
  const target = Number(value);
  const needPrev = ["increased", "decreased", "changed", "unchanged", "increased_by", "decreased_by"].includes(
    compare
  );

  const offsets = [];
  const values = [];
  const prevs = [];

  if (previous && previous.offsets && compare !== "unknown") {
    const list = previous.offsets;
    for (let i = 0; i < list.length; i++) {
      const off = list[i];
      if (off < from || off > to) continue;
      const cur = readValue(view, off, type, littleEndian);
      let ok = false;
      if (needPrev) {
        const before =
          prevView && off + meta.size <= prevView.byteLength
            ? readValue(prevView, off, type, littleEndian)
            : previous.values
              ? previous.values[i]
              : null;
        if (before == null) continue;
        ok = cmp(cur, before, compare, extra, meta.kind === "float" ? epsilon : 0);
      } else if (compare === "range") {
        ok = cmp(cur, 0, "range", extra, 0);
      } else {
        ok = cmp(cur, target, compare, extra, meta.kind === "float" ? epsilon : 0);
      }
      if (ok) {
        offsets.push(off);
        values.push(cur);
        if (offsets.length >= limit) break;
      }
    }
  } else if (compare !== "unknown") {
    for (let off = from; off <= to; off += step) {
      const cur = readValue(view, off, type, littleEndian);
      let ok = false;
      if (needPrev) {
        if (!prevView || off + meta.size > prevView.byteLength) continue;
        const before = readValue(prevView, off, type, littleEndian);
        ok = cmp(cur, before, compare, extra, meta.kind === "float" ? epsilon : 0);
      } else if (compare === "range") {
        ok = cmp(cur, 0, "range", extra, 0);
      } else {
        ok = cmp(cur, target, compare, extra, meta.kind === "float" ? epsilon : 0);
      }
      if (ok) {
        offsets.push(off);
        values.push(cur);
        if (offsets.length >= limit) break;
      }
    }
  } else {
    for (let off = from; off <= to; off += step) {
      offsets.push(off);
      values.push(readValue(view, off, type, littleEndian));
      if (offsets.length >= limit) break;
    }
  }

  return {
    type,
    compare,
    count: offsets.length,
    truncated: offsets.length >= limit,
    offsets,
    values,
    prevs,
    scannedBytes: to - from + meta.size,
  };
}

export function groupScan(buffer, pattern, opts = {}) {
  const { start = 0, end = null, littleEndian = true, limit = 2000 } = opts;
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const span = pattern.reduce((m, p) => Math.max(m, (p.offset || 0) + (TYPES[p.type]?.size || 4)), 0);
  const from = Math.max(0, start);
  const to = Math.min(bytes.byteLength - span, end == null ? bytes.byteLength : end);
  const step = opts.aligned === false ? 1 : 4;
  const hits = [];

  for (let base = from; base <= to; base += step) {
    let ok = true;
    const fields = [];
    for (const p of pattern) {
      const off = base + (p.offset || 0);
      if (off + TYPES[p.type].size > bytes.byteLength) {
        ok = false;
        break;
      }
      const cur = readValue(view, off, p.type, littleEndian);
      const eps = TYPES[p.type].kind === "float" ? p.epsilon ?? 0.01 : 0;
      if (p.compare === "any") {
        fields.push(cur);
        continue;
      }
      const target = Number(p.value);
      if (Math.abs(cur - target) > eps) {
        ok = false;
        break;
      }
      fields.push(cur);
    }
    if (ok) {
      hits.push({ offset: base, fields });
      if (hits.length >= limit) break;
    }
  }
  return { count: hits.length, hits };
}

export function scanUtf8(buffer, text, limit = 400) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer);
  const needle = new TextEncoder().encode(text);
  const hits = [];
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    hits.push(i);
    if (hits.length >= limit) break;
  }
  return { count: hits.length, offsets: hits, length: needle.length };
}

export function hexDump(buffer, offset, length = 96) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer);
  const from = Math.max(0, offset);
  const to = Math.min(bytes.length, from + length);
  const lines = [];
  for (let i = from; i < to; i += 16) {
    const slice = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      if (i + j < to) {
        const b = bytes[i + j];
        slice.push(b.toString(16).padStart(2, "0"));
        ascii.push(b >= 32 && b < 127 ? String.fromCharCode(b) : ".");
      } else {
        slice.push("  ");
        ascii.push(" ");
      }
    }
    lines.push(
      `${i.toString(16).toUpperCase().padStart(8, "0")}  ${slice.slice(0, 8).join(" ")}  ${slice
        .slice(8)
        .join(" ")}  |${ascii.join("")}|`
    );
  }
  return lines.join("\n");
}

export function parseSaveFile(text, name = "save") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { kind: "empty", entries: [] };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      return { kind: "json", name, entries: flattenJson(json) };
    } catch {
      /* fallthrough */
    }
  }
  if (trimmed.startsWith("<")) {
    return { kind: "xml", name, entries: flattenXml(trimmed) };
  }
  const kv = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_./:-]+)\s*[=:]\s*(.+)\s*$/);
    if (m) kv.push({ path: m[1], value: coerce(m[2]), type: guessType(m[2]) });
  }
  if (kv.length) return { kind: "kv", name, entries: kv };
  return { kind: "text", name, entries: [{ path: name, value: trimmed.slice(0, 200), type: "string" }] };
}

function flattenJson(obj, prefix = "", out = []) {
  if (obj == null) return out;
  if (typeof obj !== "object") {
    out.push({ path: prefix || "value", value: obj, type: typeof obj === "number" ? guessNum(obj) : "string" });
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flattenJson(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

function flattenXml(xml) {
  const entries = [];
  const re = /<([A-Za-z0-9_:-]+)([^>]*)>([^<]*)<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    const val = m[3].trim();
    if (val) entries.push({ path: m[1], value: coerce(val), type: guessType(val) });
  }
  const attr = /\s([A-Za-z0-9_:-]+)="([^"]+)"/g;
  let a;
  while ((a = attr.exec(xml))) {
    entries.push({ path: `@${a[1]}`, value: coerce(a[2]), type: guessType(a[2]) });
  }
  return entries;
}

function coerce(s) {
  const t = String(s).trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  return t;
}
function guessType(s) {
  const t = String(s).trim();
  if (t === "true" || t === "false") return "bool";
  if (/^-?\d+$/.test(t)) return "i32";
  if (/^-?\d+\.\d+$/.test(t)) return "f32";
  return "string";
}
function guessNum(n) {
  return Number.isInteger(n) ? "i32" : "f32";
}

export function diffBuffers(a, b, limit = 400) {
  const A = new Uint8Array(a);
  const B = new Uint8Array(b);
  const n = Math.min(A.length, B.length);
  const diffs = [];
  for (let i = 0; i < n; i++) {
    if (A[i] !== B[i]) {
      diffs.push({ offset: i, a: A[i], b: B[i] });
      if (diffs.length >= limit) break;
    }
  }
  return { count: diffs.length, truncated: diffs.length >= limit, diffs, sizeA: A.length, sizeB: B.length };
}
