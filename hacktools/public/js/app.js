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
  broadcast: "Broadcast",
  download: "Unduh APK",
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

function applySession(user, token) {
  state.user = user;
  state.token = token || state.token;
  try {
    if (token) localStorage.setItem("reexzy.token", token);
    localStorage.setItem("reexzy.user", JSON.stringify(user));
  } catch {}
  const pill = $("#user-pill");
  if (pill) pill.textContent = user.role === "owner" ? "owner · v1.0.1" : user.username;
  $("#gate")?.classList.add("hidden");
}

function clearSession() {
  state.user = null;
  state.token = "";
  try {
    localStorage.removeItem("reexzy.token");
    localStorage.removeItem("reexzy.user");
  } catch {}
  $("#gate")?.classList.remove("hidden");
  const pill = $("#user-pill");
  if (pill) pill.textContent = "tamu";
}

function bindAuth() {
  let mode = "login";
  $("#tab-login")?.addEventListener("click", () => {
    mode = "login";
    $("#tab-login").classList.add("on");
    $("#tab-signup").classList.remove("on");
    $("#auth-name-wrap").style.display = "none";
    $("#auth-go").textContent = "Masuk";
  });
  $("#tab-signup")?.addEventListener("click", () => {
    mode = "signup";
    $("#tab-signup").classList.add("on");
    $("#tab-login").classList.remove("on");
    $("#auth-name-wrap").style.display = "";
    $("#auth-go").textContent = "Daftar";
  });
  $("#auth-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#auth-user").value.trim();
    const password = $("#auth-pass").value;
    const displayName = $("#auth-name").value.trim();
    const url = mode === "signup" ? "/api/auth/register" : "/api/auth/login";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal auth");
      applySession(data.user, data.session.token);
      toast(data.user.role === "owner" ? "Owner v1.0.1 — hangus di versi berikutnya" : "Selamat datang");
      log("login " + data.user.username + " (" + data.user.role + ")", "ok");
    } catch (err) {
      toast(err.message, "err");
    }
  });
  $("#logout-btn")?.addEventListener("click", () => {
    clearSession();
    toast("Keluar");
  });
}

async function boot() {
  bindAuth();
  try {
    const saved = localStorage.getItem("reexzy.token");
    const u = localStorage.getItem("reexzy.user");
    if (saved && u) applySession(JSON.parse(u), saved);
  } catch {}
  try {
    const h = await health();
    log(`ReexzyINJ ${h.version} · ${h.package || ""}`, "ok");
  } catch {
    log("Server belum merespons /api/health", "warn");
  }
  const hash = (location.hash || "#home").slice(1);
  show(hash);
  setTimeout(() => $("#boot")?.classList.add("gone"), 900);
}

boot();

window.HEX = { show, state, setOwned, titles: TITLES };
