import { state, loadPersisted, setOwned } from "./state.js";
import { $, $all, log, setCrumb, setChips, toast } from "./ui.js";
import { views, bindRender, stopFarmLoop } from "./views.js";
import { health } from "./apk.js";

loadPersisted();
bindRender(show);

const TITLES = {
  home: "Beranda",
  lab: "Farm Lab",
  scanner: "Memory Lab",
  apk: "APK Inject",
  vspace: "V-Space",
  bridge: "Bridge",
  download: "Unduh",
  policy: "Kebijakan",
};

function show(name) {
  const key = views[name] ? name : "home";
  if (state.view === "lab" && key !== "lab") stopFarmLoop();
  state.view = key;
  const slot = $("#main");
  slot.innerHTML = views[key].render();
  views[key].after();
  setCrumb(key);
  setChips();
  $all(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === key));
  if (location.hash.slice(1) !== key) history.replaceState({ view: key }, "", "#" + key);
}

window.addEventListener("hashchange", () => {
  const next = (location.hash || "#home").slice(1);
  if (next && next !== state.view) show(next);
});

$all(".nav-btn").forEach((b) => {
  b.addEventListener("click", () => show(b.dataset.view));
});

$("#toggle-inspect")?.addEventListener("click", () => {
  $("#app").classList.toggle("no-inspect");
});

$("#clr-log")?.addEventListener("click", () => {
  $("#log").innerHTML = "";
  state.logs = [];
});

$("#cmd")?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim().toLowerCase();
  e.target.value = "";
  const map = [
    ["farm", "lab"],
    ["lab", "lab"],
    ["scan", "scanner"],
    ["memori", "scanner"],
    ["memory", "scanner"],
    ["inject", "apk"],
    ["apk", "apk"],
    ["vspace", "vspace"],
    ["virtual", "vspace"],
    ["bridge", "bridge"],
    ["unduh", "download"],
    ["download", "download"],
    ["policy", "policy"],
    ["kebijakan", "policy"],
    ["home", "home"],
    ["beranda", "home"],
  ];
  const hit = map.find(([k]) => q.includes(k));
  if (hit) show(hit[1]);
  else toast("Perintah tidak dikenal");
});

$("#modal")?.addEventListener("click", (e) => {
  if (e.target.id === "modal") e.target.classList.remove("show");
});

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__hexPrompt = e;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

async function boot() {
  try {
    const h = await health();
    log(`HEX ${h.version} · policy ${h.policy}`, "ok");
  } catch {
    log("Server HEX belum merespons /api/health", "warn");
  }
  const hash = (location.hash || "#home").slice(1);
  show(hash);
  setTimeout(() => $("#boot")?.classList.add("gone"), 900);
}

boot();

window.HEX = { show, state, setOwned, titles: TITLES };
