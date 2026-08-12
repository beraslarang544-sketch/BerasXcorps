export const state = {
  view: "home",
  owned: false,
  ownerName: "",
  packageHint: "id.berasxcorps.farm",
  apk: null,
  dump: null,
  prevDump: null,
  lastScan: null,
  selected: null,
  tables: [],
  farm: {
    gold: 120,
    rice: 48,
    water: 70,
    planted: 12,
    speed: 1,
    frozen: { gold: false, rice: false, water: false },
  },
  bridge: { status: "idle", last: null, values: {} },
  logs: [],
  user: null,
  token: \"\",
};

export function setOwned(v, name = "") {
  state.owned = !!v;
  if (name) state.ownerName = name;
  try {
    localStorage.setItem("hex.owned", state.owned ? "1" : "0");
    localStorage.setItem("hex.owner", state.ownerName);
  } catch {}
}

export function loadPersisted() {
  try {
    state.owned = localStorage.getItem("hex.owned") === "1";
    state.ownerName = localStorage.getItem("hex.owner") || "";
    const t = localStorage.getItem("hex.tables");
    if (t) state.tables = JSON.parse(t);
  } catch {}
}

export function persistTables() {
  try { localStorage.setItem("hex.tables", JSON.stringify(state.tables)); } catch {}
}

export function requireOwned() {
  if (!state.owned) {
    const err = new Error("Aktifkan pernyataan kepemilikan dulu (hanya APK milik Anda).");
    err.code = "OWNED";
    throw err;
  }
}
