import { state } from "./state.js";

const TITLES = {
  home: "Beranda",
  lab: "Farm Lab",
  scanner: "Memory Lab",
  apk: "APK Inject",
  vspace: "V-Space",
  bridge: "Bridge",
  download: "Unduh APK",
  broadcast: "Broadcast",
  policy: "Kebijakan",
};

export function $(sel, root = document) { return root.querySelector(sel); }
export function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function log(msg, level = "info") {
  const line = `[${new Date().toLocaleTimeString("id-ID")}] ${msg}`;
  state.logs.push({ line, level });
  if (state.logs.length > 400) state.logs.shift();
  const el = $("#log");
  if (!el) return;
  const div = document.createElement("div");
  div.className = level;
  div.textContent = line;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

export function toast(msg, kind = "ok") {
  const host = $("#toasts");
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

export function setCrumb(view) {
  const el = $("#crumb");
  if (el) el.textContent = TITLES[view] || view;
}

export function setChips() {
  const o = $("#own-chip");
  const w = $("#ws-chip");
  if (o) o.textContent = state.owned ? `ownership: ${state.ownerName || "on"}` : "ownership: off";
  if (w) w.textContent = `bridge: ${state.bridge.status}`;
}

export function inspect(html) {
  const el = $("#inspector");
  if (el) el.innerHTML = html;
}

export function modal(html) {
  $("#modal-sheet").innerHTML = html;
  $("#modal").classList.add("show");
}

export function closeModal() {
  $("#modal").classList.remove("show");
}

export function fmt(n) {
  return Number(n).toLocaleString("id-ID");
}

export function hex(n, w = 8) {
  const v = (Number(n) >>> 0).toString(16).toUpperCase();
  return "0x" + v.padStart(w, "0");
}

export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ownershipBox() {
  return `
    <div class="own">
      <input type="checkbox" id="own-check" ${state.owned ? "checked" : ""} />
      <div>
        <b>Saya pemilik sah APK / proses ini</b>
        <div class="muted">HEX hanya untuk first-party: game atau app yang Anda buat. Tidak untuk WhatsApp orang lain, attach proses pihak ketiga, atau VirtualApp.</div>
        <label class="field" style="margin-top:8px">
          Nama pemilik / studio
          <input id="own-name" value="${state.ownerName || ""}" placeholder="mis. BerasXcorps" />
        </label>
      </div>
    </div>`;
}
