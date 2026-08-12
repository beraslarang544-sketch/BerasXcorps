import { state } from "./state.js";
import { log, setChips, toast } from "./ui.js";

let socket = null;
const listeners = new Set();

export function onBridge(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function connect(pkg = "id.berasxcorps.farm", token = "") {
  disconnect();
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/bridge?role=studio&pkg=${encodeURIComponent(pkg)}&token=${encodeURIComponent(token)}`;
  socket = new WebSocket(url);
  state.bridge.status = "connecting";
  setChips();
  socket.addEventListener("open", () => {
    state.bridge.status = "live";
    setChips();
    log("Bridge terhubung " + pkg, "ok");
    send({ type: "hello", role: "studio", pkg });
  });
  socket.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    state.bridge.last = msg;
    if (msg.type === "values" && msg.values) state.bridge.values = msg.values;
    for (const fn of listeners) fn(msg);
  });
  socket.addEventListener("close", () => {
    state.bridge.status = "idle";
    setChips();
    log("Bridge terputus", "warn");
  });
  socket.addEventListener("error", () => {
    state.bridge.status = "error";
    setChips();
    toast("Bridge gagal — cek server HEX", "err");
  });
}

export function disconnect() {
  if (socket) {
    try { socket.close(); } catch {}
    socket = null;
  }
  state.bridge.status = "idle";
  setChips();
}

export function send(msg) {
  if (!socket || socket.readyState !== 1) {
    toast("Bridge belum hidup", "err");
    return false;
  }
  socket.send(JSON.stringify({ ...msg, at: Date.now() }));
  return true;
}

export function setValue(id, value) {
  return send({ type: "set", id, value });
}

export function freeze(id, on = true) {
  return send({ type: "freeze", id, on });
}

export function setSpeed(scale) {
  return send({ type: "speed", scale });
}
