import {
  scanBuffer,
  groupScan,
  scanUtf8,
  hexDump,
  parseSaveFile,
  diffBuffers,
  readValue,
  writeValue,
} from "/lib/scanner.js";

self.onmessage = (ev) => {
  const { id, op, payload } = ev.data || {};
  try {
    let result;
    switch (op) {
      case "scan":
        result = scanBuffer(payload);
        break;
      case "group":
        result = groupScan(payload.buffer, payload.pattern, payload.opts || {});
        break;
      case "utf8":
        result = scanUtf8(payload.buffer, payload.text, payload.limit || 400);
        break;
      case "hex":
        result = hexDump(payload.buffer, payload.offset || 0, payload.length || 96);
        break;
      case "save":
        result = parseSaveFile(payload.text, payload.name || "save");
        break;
      case "diff":
        result = diffBuffers(payload.a, payload.b, payload.limit || 400);
        break;
      case "read":
        result = readValue(new DataView(payload.buffer), payload.offset, payload.type, payload.le !== false);
        break;
      case "write": {
        const view = new DataView(payload.buffer);
        writeValue(view, payload.offset, payload.type, payload.value, payload.le !== false);
        result = { buffer: payload.buffer };
        break;
      }
      default:
        throw new Error("op tidak dikenal: " + op);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err.message || err) });
  }
};
