let worker;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker("/js/scan-worker.js", { type: "module" });
    worker.onmessage = (ev) => {
      const { id, ok, result, error } = ev.data || {};
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      ok ? job.resolve(result) : job.reject(new Error(error));
    };
    worker.onerror = (e) => {
      for (const [, job] of pending) job.reject(new Error(e.message || "worker error"));
      pending.clear();
    };
  }
  return worker;
}

function call(op, payload) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, op, payload });
  });
}

export const scan = (payload) => call("scan", payload);
export const group = (buffer, pattern, opts) => call("group", { buffer, pattern, opts });
export const utf8 = (buffer, text, limit) => call("utf8", { buffer, text, limit });
export const dumpHex = (buffer, offset, length) => call("hex", { buffer, offset, length });
export const parseSave = (text, name) => call("save", { text, name });
export const diff = (a, b, limit) => call("diff", { a, b, limit });
export const readAt = (buffer, offset, type, le) => call("read", { buffer, offset, type, le });
export const writeAt = (buffer, offset, type, value, le) =>
  call("write", { buffer, offset, type, value, le });
