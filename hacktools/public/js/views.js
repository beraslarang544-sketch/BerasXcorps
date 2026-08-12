import { state, setOwned, persistTables, requireOwned } from "./state.js";
import { $, $all, log, toast, inspect, ownershipBox, downloadBlob, hex, fmt } from "./ui.js";
import { farmDump, tickFarm, plant, harvest, FARM_SCHEMA } from "./farm.js";
import * as scanner from "./scanner.js";
import { analyzeApk, injectApk, packVspace, health } from "./apk.js";
import { connect, disconnect, setValue, freeze, setSpeed, onBridge } from "./bridge.js";

let farmTimer = null;
let renderFn = () => {};

export function bindRender(fn) {
  renderFn = fn;
}

export function stopFarmLoop() {
  if (farmTimer) {
    clearInterval(farmTimer);
    farmTimer = null;
  }
}

function bindOwn() {
  const c = $("#own-check");
  const n = $("#own-name");
  if (c) {
    c.addEventListener("change", () => {
      setOwned(c.checked, n?.value || "");
      import("./ui.js").then((u) => u.setChips());
      log(c.checked ? "Kepemilikan diaktifkan" : "Kepemilikan dimatikan", c.checked ? "ok" : "warn");
    });
  }
  if (n) {
    n.addEventListener("change", () => {
      if (state.owned) setOwned(true, n.value);
    });
  }
}

function wireDrop(el, onFile) {
  if (!el) return;
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("hot");
  });
  el.addEventListener("dragleave", () => el.classList.remove("hot"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("hot");
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  });
  const inp = el.querySelector("input[type=file]");
  if (inp) inp.addEventListener("change", () => inp.files[0] && onFile(inp.files[0]));
}

export function viewHome() {
  return `
    <section class="hero">
      <img src="/assets/hero-radar.jpg" alt="" />
      <div class="veil"></div>
      <div class="copy">
        <div class="tag">First-party · tanpa decompile · tanpa ptrace</div>
        <h1 class="h1">Studio memori untuk APK milikmu.</h1>
        <p class="lead">HEX meniru alur Game Guardian yang sederhana — scan, refine, freeze — tapi lebih ketat: tipe aligned, epsilon float, group scan, dan save-file. Inject hanya menyisipkan <code>assets/xcorps/*</code>. Virtual Space adalah host sidecar, bukan Parallel Space.</p>
        <div class="row" style="margin-top:16px">
          <button class="btn gold" data-go="lab">Buka Farm Lab</button>
          <button class="btn cyan" data-go="apk">Inject APK</button>
          <button class="btn" data-go="download">Unduh studio</button>
        </div>
      </div>
    </section>
    <div class="grid-3" style="margin-top:18px">
      <article class="card">
        <img class="thumb" src="/assets/hero-radar.jpg" alt="" />
        <h3>Memory Lab</h3>
        <p>Scan dump milikmu dengan i8–f64, unknown/changed, group pattern, UTF-8, dan diff dua dump. Bukan attach proses orang lain.</p>
        <button class="btn" data-go="scanner" style="margin-top:12px">Buka scanner</button>
      </article>
      <article class="card">
        <img class="thumb" src="/assets/inject-core.jpg" alt="" />
        <h3>Inject tanpa decompile</h3>
        <p>ZIP-level saja. DEX dan smali tidak disentuh. Tanda tangan META-INF dilepas — Anda sign ulang dengan kunci rilis sendiri.</p>
        <button class="btn" data-go="apk" style="margin-top:12px">Suntik payload</button>
      </article>
      <article class="card">
        <img class="thumb" src="/assets/vspace-iso.jpg" alt="" />
        <h3>V-Space host</h3>
        <p>Proyek Kotlin <code>id.berasxcorps.hex.vspace</code>: launch paketmu, profil terisolasi, overlay broadcast ke SDK.</p>
        <button class="btn" data-go="vspace" style="margin-top:12px">Rakit host</button>
      </article>
    </div>
    <div class="card" style="margin-top:16px">
      ${ownershipBox()}
    </div>`;
}

export function afterHome() {
  bindOwn();
  $all("[data-go]").forEach((b) => b.addEventListener("click", () => renderFn(b.dataset.go)));
  inspect(`<h3>HEX</h3><p class="muted">Studio first-party BerasXcorps. Tidak ada hook WhatsApp, tidak ada VirtualApp.</p>`);
}

export function viewLab() {
  const f = state.farm;
  return `
    <h1 class="h1">Farm Lab</h1>
    <p class="lead">Simulasi proses milikmu — <code>id.berasxcorps.farm</code>. Nilai hidup di dump 8 KB. Scanner memakai offset aligned, sama seperti Memory Lab.</p>
    <div class="farm" style="margin-top:16px">
      <div class="card">
        <div class="paddy">
          <div class="hud">
            <span>GOLD ${fmt(f.gold)}</span>
            <span>BERAS ${fmt(f.rice)}</span>
            <span>×${f.speed.toFixed(1)}</span>
          </div>
          <div class="rice">${Array.from({ length: Math.min(18, 4 + f.planted) }, () => '<i class="stalk" style="height:' + (40 + Math.random() * 50) + 'px"></i>').join("")}</div>
        </div>
        <div class="row" style="margin-top:12px">
          <div class="stat"><b>${fmt(f.gold)}</b><span>gold ${f.frozen.gold ? "❄" : ""}</span></div>
          <div class="stat"><b>${fmt(f.rice)}</b><span>beras ${f.frozen.rice ? "❄" : ""}</span></div>
          <div class="stat"><b>${f.water.toFixed(1)}</b><span>air ${f.frozen.water ? "❄" : ""}</span></div>
          <div class="stat"><b>${f.planted}</b><span>tanaman</span></div>
        </div>
        <div class="bar" style="margin:12px 0"><i style="width:${Math.min(100, f.water)}%"></i></div>
        <div class="tools">
          <button class="btn gold" id="btn-plant">Tanam</button>
          <button class="btn" id="btn-harvest">Panen</button>
          <button class="btn cyan" id="btn-dump">Ambil dump</button>
          <button class="btn" id="btn-scan-gold">Scan gold=${f.gold}</button>
        </div>
      </div>
      <div class="card">
        <h3>Kontrol first-party</h3>
        <p>Ini setara SDK di dalam game milikmu — bukan ptrace.</p>
        <div class="tools">
          <button class="btn" data-fr="gold">${f.frozen.gold ? "Cairkan gold" : "Bekukan gold"}</button>
          <button class="btn" data-fr="rice">${f.frozen.rice ? "Cairkan beras" : "Bekukan beras"}</button>
          <button class="btn" data-fr="water">${f.frozen.water ? "Cairkan air" : "Bekukan air"}</button>
        </div>
        <label class="field">Speed scale
          <input type="range" id="spd" min="0.2" max="4" step="0.1" value="${f.speed}" />
        </label>
        <label class="field">Set gold
          <input id="set-gold" type="number" value="${f.gold}" />
        </label>
        <button class="btn gold" id="apply-gold">Tulis ke dump</button>
        <div class="tiny" style="margin-top:10px">Offset: gold ${hex(0x1000)} · beras ${hex(0x1008)} · air ${hex(0x1010)}</div>
      </div>
    </div>`;
}

export function afterLab() {
  if (!farmTimer) {
    farmTimer = setInterval(() => {
      tickFarm();
      if (state.view === "lab") renderFn("lab");
    }, 1600);
  }
  $("#btn-plant")?.addEventListener("click", () => {
    if (!plant()) toast("Air kurang", "err");
    else { log("Tanam +3", "ok"); renderFn("lab"); }
  });
  $("#btn-harvest")?.addEventListener("click", () => {
    const g = harvest();
    log("Panen +" + g, "ok");
    renderFn("lab");
  });
  $("#btn-dump")?.addEventListener("click", () => {
    state.dump = farmDump();
    toast("Dump Farm 8 KB diambil");
    log("Dump farm tersimpan di Memory Lab", "ok");
  });
  $("#btn-scan-gold")?.addEventListener("click", async () => {
    state.dump = farmDump();
    const r = await scanner.scan({
      buffer: state.dump,
      type: "i32",
      compare: "eq",
      value: state.farm.gold,
      aligned: true,
    });
    state.lastScan = r;
    toast(r.count + " hit untuk gold");
    log(`Scan gold=${state.farm.gold} → ${r.count} alamat`, "ok");
    renderFn("scanner");
  });
  $all("[data-fr]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.fr;
      state.farm.frozen[k] = !state.farm.frozen[k];
      log((state.farm.frozen[k] ? "Freeze " : "Unfreeze ") + k, "info");
      renderFn("lab");
    })
  );
  $("#spd")?.addEventListener("input", (e) => {
    state.farm.speed = Number(e.target.value);
  });
  $("#apply-gold")?.addEventListener("click", () => {
    state.farm.gold = Number($("#set-gold").value) || 0;
    toast("Gold ditulis");
    renderFn("lab");
  });
  inspect(`<h3>Schema Farm</h3><div class="kvs">${FARM_SCHEMA.fields.map((f) => `<div><span>${f.name}</span><b>${f.type} ${hex(f.offset)}</b></div>`).join("")}</div>`);
}

export function viewScanner() {
  const s = state.lastScan;
  const rows = s?.offsets?.slice(0, 80).map((off, i) => {
    const sel = state.selected === off ? "sel" : "";
    return `<tr class="${sel}" data-off="${off}"><td>${hex(off)}</td><td>${s.values[i]}</td><td>${s.type}</td></tr>`;
  }).join("") || `<tr><td colspan="3" class="muted">Belum ada hasil. Ambil dump Farm atau unggah bin.</td></tr>`;
  return `
    <h1 class="h1">Memory Lab</h1>
    <p class="lead">Lebih akurat dari scan buta: alignment = ukuran tipe, float memakai epsilon, refine memakai daftar hit sebelumnya.</p>
    <div class="card">
      ${ownershipBox()}
      <div class="split" style="margin-top:14px">
        <label class="field">Tipe
          <select id="sc-type">
            ${["i8","u8","i16","u16","i32","u32","i64","f32","f64"].map((t) => `<option ${t==="i32"?"selected":""}>${t}</option>`).join("")}
          </select>
        </label>
        <label class="field">Bandingkan
          <select id="sc-cmp">
            <option value="eq">sama dengan</option>
            <option value="ne">tidak sama</option>
            <option value="gt">lebih besar</option>
            <option value="lt">lebih kecil</option>
            <option value="range">rentang</option>
            <option value="unknown">unknown (first)</option>
            <option value="changed">berubah</option>
            <option value="unchanged">tetap</option>
            <option value="increased">naik</option>
            <option value="decreased">turun</option>
          </select>
        </label>
        <label class="field">Nilai
          <input id="sc-val" type="number" value="120" />
        </label>
        <label class="field">Epsilon (float)
          <input id="sc-eps" type="number" step="0.001" value="0.01" />
        </label>
      </div>
      <label class="field" style="margin-top:8px">
        <span><input type="checkbox" id="sc-align" checked /> aligned (disarankan)</span>
      </label>
      <div class="tools">
        <button class="btn gold" id="sc-run">Scan dump</button>
        <button class="btn" id="sc-farm">Pakai dump Farm</button>
        <button class="btn" id="sc-file">Unggah .bin</button>
        <button class="btn cyan" id="sc-group">Group scan Farm</button>
        <button class="btn" id="sc-save">Parse save JSON/XML</button>
        <input id="bin-file" type="file" hidden />
        <input id="save-file" type="file" hidden accept=".json,.xml,.txt" />
      </div>
      <div class="tiny">${state.dump ? "Dump aktif: " + state.dump.byteLength + " B" : "Tidak ada dump"} · hit ${s?.count ?? 0}${s?.truncated ? " (terpotong)" : ""}</div>
    </div>
    <div class="card" style="margin-top:14px">
      <table class="data">
        <thead><tr><th>Offset</th><th>Nilai</th><th>Tipe</th></tr></thead>
        <tbody id="sc-rows">${rows}</tbody>
      </table>
    </div>`;
}

export function afterScanner() {
  bindOwn();
  $("#sc-farm")?.addEventListener("click", () => {
    state.dump = farmDump();
    toast("Dump Farm siap");
    renderFn("scanner");
  });
  $("#sc-file")?.addEventListener("click", () => $("#bin-file").click());
  $("#bin-file")?.addEventListener("change", async () => {
    const f = $("#bin-file").files[0];
    if (!f) return;
    state.dump = await f.arrayBuffer();
    toast("Dump " + f.name);
    renderFn("scanner");
  });
  $("#sc-run")?.addEventListener("click", async () => {
    try {
      requireOwned();
      if (!state.dump) state.dump = farmDump();
      const type = $("#sc-type").value;
      const compare = $("#sc-cmp").value;
      const r = await scanner.scan({
        buffer: state.dump,
        prevBuffer: state.prevDump || null,
        type,
        compare,
        value: Number($("#sc-val").value),
        epsilon: Number($("#sc-eps").value),
        aligned: $("#sc-align").checked,
        previous: state.lastScan,
      });
      state.prevDump = state.dump.slice(0);
      state.lastScan = r;
      log(`Scan ${type} ${compare} → ${r.count} hit`, "ok");
      renderFn("scanner");
    } catch (e) {
      toast(e.message, "err");
      log(e.message, "err");
    }
  });
  $("#sc-group")?.addEventListener("click", async () => {
    try {
      requireOwned();
      state.dump = farmDump();
      const r = await scanner.group(state.dump, [
        { offset: 0, type: "i32", value: state.farm.gold },
        { offset: 8, type: "i32", value: state.farm.rice },
      ], { start: 0x0ff0, end: 0x1040 });
      toast("Group scan: " + r.count + " base");
      log("Group gold+beras → " + JSON.stringify(r.hits.slice(0, 3)), "ok");
    } catch (e) {
      toast(e.message, "err");
    }
  });
  $("#sc-save")?.addEventListener("click", () => $("#save-file").click());
  $("#save-file")?.addEventListener("change", async () => {
    const f = $("#save-file").files[0];
    if (!f) return;
    const text = await f.text();
    const parsed = await scanner.parseSave(text, f.name);
    inspect(`<h3>Save ${parsed.kind}</h3><div class="kvs">${parsed.entries.slice(0, 24).map((e) => `<div><span>${e.path}</span><b>${e.value}</b></div>`).join("")}</div>`);
    toast(parsed.entries.length + " entri save");
  });
  $all("#sc-rows tr[data-off]").forEach((tr) => {
    tr.addEventListener("click", async () => {
      const off = Number(tr.dataset.off);
      state.selected = off;
      const hx = await scanner.dumpHex(state.dump, Math.max(0, off - 16), 96);
      inspect(`<h3>${hex(off)}</h3><div class="hex">${hx}</div>
        <div class="tools"><button class="btn gold" id="add-tbl">Tambah ke tabel</button></div>`);
      $("#add-tbl")?.addEventListener("click", () => {
        state.tables.push({
          id: "f" + off.toString(16),
          label: "addr " + hex(off),
          type: $("#sc-type")?.value || "i32",
          offset: off,
          value: state.lastScan?.values?.[state.lastScan.offsets.indexOf(off)] ?? 0,
          freeze: false,
        });
        persistTables();
        toast("Masuk tabel cheat");
      });
    });
  });
}

export function viewApk() {
  const info = state.apk;
  return `
    <h1 class="h1">APK Inject</h1>
    <p class="lead">Tidak ada jadx, tidak ada apktool. HEX membuka APK sebagai ZIP, menulis <code>assets/xcorps/*</code>, dan membuang signature lama.</p>
    <div class="split">
      <div class="card">
        ${ownershipBox()}
        <div class="drop" id="apk-drop" style="margin-top:14px">
          <img src="/assets/inject-core.jpg" alt="" style="width:72px;height:72px;margin:0 auto 10px;border-radius:12px" />
          <b>Jatuhkan APK milikmu</b>
          <p class="muted">atau pilih berkas</p>
          <input type="file" accept=".apk,application/vnd.android.package-archive" />
        </div>
        <div class="tools">
          <button class="btn" id="sample-apk">Unduh sample BerasFarm</button>
          <button class="btn cyan" id="do-analyze" ${info ? "" : "disabled"}>Analisis ulang</button>
          <button class="btn gold" id="do-inject" ${info ? "" : "disabled"}>Inject HEX</button>
        </div>
      </div>
      <div class="card">
        <h3>Hasil analisis</h3>
        ${info ? `
          <div class="kvs">
            <div><span>Berkas</span><b>${info.filename || "apk"}</b></div>
            <div><span>Package</span><b>${info.package || "—"}</b></div>
            <div><span>Label</span><b>${info.application?.label || "—"}</b></div>
            <div><span>Versi</span><b>${info.versionName || "—"} (${info.versionCode ?? "—"})</b></div>
            <div><span>SDK</span><b>min ${info.minSdk ?? "—"} / target ${info.targetSdk ?? "—"}</b></div>
            <div><span>Entri ZIP</span><b>${info.zip?.files ?? "—"}</b></div>
            <div><span>DEX</span><b>${info.dex?.length ? info.dex.length + " (header saja, tidak diubah)" : "tidak ada"}</b></div>
            <div><span>ABI</span><b>${(info.abis || []).map((a) => a.label || a.id).join(", ") || "—"}</b></div>
            <div><span>Metode</span><b>${info.method || "zip+axml"}</b></div>
            <div><span>Sudah HEX?</span><b>${info.hasXcorps ? "ya" : "belum"}</b></div>
          </div>
          <div class="hex" style="margin-top:10px;max-height:180px">${(info.topFiles || []).slice(0, 24).map((f) => f.path + "  " + (f.size || 0)).join("\n")}</div>
        ` : `<p class="muted">Belum ada APK. Sample tersedia jika Anda belum punya build.</p>`}
      </div>
    </div>`;
}

export function afterApk() {
  bindOwn();
  const handle = async (file) => {
    try {
      requireOwned();
      log("Menganalisis " + file.name, "info");
      const info = await analyzeApk(file);
      info._file = file;
      state.apk = info;
      toast("APK terbaca tanpa decompile");
      renderFn("apk");
    } catch (e) {
      toast(e.message, "err");
      log(e.message, "err");
    }
  };
  wireDrop($("#apk-drop"), handle);
  $("#sample-apk")?.addEventListener("click", () => {
    location.href = "/api/sample/apk";
  });
  $("#do-analyze")?.addEventListener("click", () => state.apk?._file && handle(state.apk._file));
  $("#do-inject")?.addEventListener("click", async () => {
    try {
      requireOwned();
      if (!state.apk?._file) throw new Error("Pilih APK dulu");
      const out = await injectApk(state.apk._file, {
        ownership: true,
        package: state.apk.package || state.packageHint,
        cheats: state.tables,
        schema: FARM_SCHEMA,
        virtualSpace: true,
      });
      downloadBlob(out.blob, out.name);
      log("Inject OK · + " + out.added, "ok");
      toast("APK unsigned diunduh — sign dengan kunci Anda");
    } catch (e) {
      toast(e.message, "err");
      log(e.message, "err");
    }
  });
  inspect(`<h3>Inject</h3><p class="muted">Yang ditulis: assets/xcorps/manifest, cheats, schema, vspace, bridge. classes.dex tidak disentuh.</p>`);
}

export function viewVspace() {
  return `
    <h1 class="h1">Virtual Space</h1>
    <p class="lead">Bukan Parallel Space. HEX merakit host Android yang hanya mengenal paket Anda: launch intent, folder profil, overlay broadcast.</p>
    <div class="split">
      <div class="card">
        <img class="thumb" src="/assets/vspace-iso.jpg" alt="" />
        ${ownershipBox()}
        <label class="field" style="margin-top:10px">Package milikmu
          <input id="vs-pkg" value="${state.packageHint}" />
        </label>
        <label class="field">Label
          <input id="vs-label" value="BerasFarm" />
        </label>
        <label class="field"><span><input type="checkbox" id="vs-ov" checked /> sertakan overlay</span></label>
        <div class="tools">
          <button class="btn gold" id="vs-pack">Unduh proyek host</button>
          <button class="btn" id="vs-with-apk">Host + APK ter-inject</button>
          <input id="vs-file" type="file" accept=".apk" hidden />
        </div>
      </div>
      <div class="card">
        <h3>Yang dihasilkan</h3>
        <p>Gradle Kotlin · <code>id.berasxcorps.hex.vspace</code> · HostActivity · OverlayService · scripts/sign.sh · scripts/adb.txt</p>
        <div class="hex">adb install -r hex-signed.apk
adb shell am broadcast -a id.berasxcorps.hex.BRIDGE \\
  --es op set --es id coins --es value 999999</div>
      </div>
    </div>`;
}

export function afterVspace() {
  bindOwn();
  const pack = async (file) => {
    try {
      requireOwned();
      const blob = await packVspace(file, {
        ownership: true,
        package: $("#vs-pkg").value,
        label: $("#vs-label").value,
        overlay: $("#vs-ov").checked,
        cheats: state.tables,
        schema: FARM_SCHEMA,
      });
      downloadBlob(blob, "hex-vspace.zip");
      toast("Paket V-Space siap");
      log("V-Space host diunduh", "ok");
    } catch (e) {
      toast(e.message, "err");
      log(e.message, "err");
    }
  };
  $("#vs-pack")?.addEventListener("click", () => pack(null));
  $("#vs-with-apk")?.addEventListener("click", () => $("#vs-file").click());
  $("#vs-file")?.addEventListener("change", () => pack($("#vs-file").files[0]));
  inspect(`<h3>Bukan VirtualApp</h3><p class="muted">Host tidak memuat APK pihak ketiga ke proses yang sama. Hanya launch + overlay + profil.</p>`);
}

export function viewBridge() {
  const vals = Object.entries(state.bridge.values || {});
  return `
    <h1 class="h1">Bridge</h1>
    <p class="lead">Kanal first-party: WebSocket <code>/bridge</code> dan broadcast <code>id.berasxcorps.hex.BRIDGE</code>. Game harus memanggil <code>XCorpsRuntime.attach</code>.</p>
    <div class="split">
      <div class="card">
        <label class="field">Package
          <input id="br-pkg" value="${state.packageHint}" />
        </label>
        <label class="field">Token (opsional)
          <input id="br-token" placeholder="HEX-…" />
        </label>
        <div class="tools">
          <button class="btn gold" id="br-on">Hubungkan</button>
          <button class="btn danger" id="br-off">Putus</button>
        </div>
        <label class="field">Set id
          <input id="br-id" value="gold" />
        </label>
        <label class="field">Nilai
          <input id="br-val" value="9999" />
        </label>
        <div class="tools">
          <button class="btn" id="br-set">Kirim set</button>
          <button class="btn" id="br-fr">Freeze</button>
          <button class="btn" id="br-spd">Speed ×2</button>
        </div>
      </div>
      <div class="card">
        <h3>Nilai live</h3>
        <div class="kvs" id="br-vals">
          ${vals.length ? vals.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("") : `<div><span>status</span><b>${state.bridge.status}</b></div>`}
        </div>
        <div class="hex" style="margin-top:10px">${state.bridge.last ? JSON.stringify(state.bridge.last, null, 2) : "// menunggu paket"}</div>
      </div>
    </div>`;
}

let bridgeBound = false;

export function afterBridge() {
  if (!bridgeBound) {
    onBridge(() => {
      if (state.view === "bridge") renderFn("bridge");
    });
    bridgeBound = true;
  }
  $("#br-on")?.addEventListener("click", () => connect($("#br-pkg").value, $("#br-token").value));
  $("#br-off")?.addEventListener("click", () => disconnect());
  $("#br-set")?.addEventListener("click", () => setValue($("#br-id").value, $("#br-val").value));
  $("#br-fr")?.addEventListener("click", () => freeze($("#br-id").value, true));
  $("#br-spd")?.addEventListener("click", () => setSpeed(2));
  inspect(`<h3>SDK</h3><p class="muted">Salin XCorpsRuntime.kt ke modul Android Anda. Unduh dari halaman Unduh.</p>`);
}

export function viewBroadcast() {
  return `
    <h1 class="h1 fade-in">Broadcast</h1>
    <p class="lead">Kirim pesan ke peer first-party lewat kanal /bridge. Bukan blast WhatsApp.</p>
    <div class="split">
      <div class="card">
        <label class="field">Kanal
          <input id="bc-ch" value="reexzy.v101" />
        </label>
        <label class="field">Pesan
          <textarea id="bc-msg" placeholder="Pengumuman studio…"></textarea>
        </label>
        <div class="tools">
          <button class="btn gold" id="bc-send">Siarkan</button>
          <button class="btn cyan" id="bc-join">Gabung kanal</button>
        </div>
      </div>
      <div class="card">
        <h3>Feed</h3>
        <div class="bc-feed" id="bc-feed"><div class="muted">Belum ada siaran.</div></div>
      </div>
    </div>`;
}

export function afterBroadcast() {
  const feed = $("#bc-feed");
  const push = (t) => {
    if (!feed) return;
    const d = document.createElement("div");
    d.textContent = `[${new Date().toLocaleTimeString("id-ID")}] ${t}`;
    feed.prepend(d);
  };
  $("#bc-join")?.addEventListener("click", () => {
    connect($("#bc-ch").value || "reexzy.v101", "");
    push("bergabung " + ($("#bc-ch").value || "reexzy.v101"));
    toast("Kanal terbuka");
  });
  $("#bc-send")?.addEventListener("click", () => {
    const msg = $("#bc-msg")?.value?.trim();
    if (!msg) return toast("Tulis pesan dulu", "err");
    setValue("broadcast", msg);
    push((state.user?.username || "me") + ": " + msg);
    toast("Tersiar");
    log("broadcast: " + msg, "ok");
  });
}

export function viewDownload() {
  return `
    <h1 class="h1 fade-in">Unduh ReexzyINJ.apk</h1>
    <p class="lead">APK resmi v1.0.1 · package com.reexzyinject.re.com. Sign ulang dengan kunci rilis Anda sebelum pasang.</p>
    <div class="grid-3">
      <article class="card">
        <h3>ReexzyINJ.apk</h3>
        <p>Build 1.0.1 siap unduh. Owner login v1.0.1 hangus di versi berikutnya.</p>
        <a class="btn gold" href="/api/download/ReexzyINJ.apk" style="display:inline-block;margin-top:12px">Unduh ReexzyINJ.apk</a>
      </article>
      <article class="card">
        <h3>Web app</h3>
        <p>SPA + aset + service worker. Buka lewat server HEX.</p>
        <a class="btn gold" href="/api/download/webapp" style="display:inline-block;margin-top:12px">HEX-Studio-webapp.zip</a>
      </article>
      <article class="card">
        <h3>SDK</h3>
        <p>Kotlin + Java runtime + PROTOCOL.md</p>
        <a class="btn cyan" href="/api/download/sdk" style="display:inline-block;margin-top:12px">HEX-SDK.zip</a>
      </article>
      <article class="card">
        <h3>Full studio</h3>
        <p>Server, lib, public, templates.</p>
        <a class="btn" href="/api/download/full" style="display:inline-block;margin-top:12px">BerasXcorps-HEX-full.zip</a>
      </article>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="row">
        <a class="btn" href="/api/sample/apk">Sample APK BerasFarm</a>
        <a class="btn" href="/api/download/sign-script">hex-sign.sh</a>
        <a class="btn" href="/templates/cheats.example.json" download>cheats.example.json</a>
        <button class="btn gold" id="pwa">Pasang PWA</button>
      </div>
    </div>`;
}

export function afterDownload() {
  $("#pwa")?.addEventListener("click", async () => {
    if (window.__hexPrompt) {
      window.__hexPrompt.prompt();
      window.__hexPrompt.userChoice.then((c) => log("PWA " + c.outcome, "info"));
    } else {
      toast("Pakai menu Install di browser, atau buka lewat HTTPS/preview");
    }
  });
  inspect(`<h3>PWA</h3><p class="muted">Manifest + SW cache hex-studio-v2. API tidak di-cache.</p>`);
}

export function viewPolicy() {
  return `
    <h1 class="h1">Kebijakan</h1>
    <p class="lead">HEX dibangun sebagai alat first-party. Permintaan di luar itu ditolak di UI dan di server.</p>
    <div class="grid-2">
      <article class="card">
        <h3>Diterima</h3>
        <p>APK yang Anda tanda-tangani · dump memori proses Anda · save JSON/XML game Anda · host V-Space untuk paket Anda · SDK di dalam source Anda.</p>
      </article>
      <article class="card">
        <h3>Ditolak</h3>
        <p>Attach proses sebarang · Frida/ptrace ke app orang · VirtualApp / Xposed · decompile smali · exploit root · blast WhatsApp.</p>
      </article>
    </div>
    <div class="card" style="margin-top:14px">${ownershipBox()}</div>`;
}

export function afterPolicy() {
  bindOwn();
  health().then((h) => {
    inspect(`<h3>Engine</h3><div class="kvs"><div><span>ok</span><b>${h.ok}</b></div><div><span>decompile</span><b>${h.decompile}</b></div><div><span>ptrace</span><b>${h.ptrace}</b></div><div><span>virtualApp</span><b>${h.virtualApp}</b></div></div>`);
  }).catch(() => {});
}

export const views = {
  home: { render: viewHome, after: afterHome },
  lab: { render: viewLab, after: afterLab },
  scanner: { render: viewScanner, after: afterScanner },
  apk: { render: viewApk, after: afterApk },
  vspace: { render: viewVspace, after: afterVspace },
  bridge: { render: viewBridge, after: afterBridge },
  broadcast: { render: viewBroadcast, after: afterBroadcast },
  download: { render: viewDownload, after: afterDownload },
  policy: { render: viewPolicy, after: afterPolicy },
};
