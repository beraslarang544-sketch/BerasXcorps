import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { rm } from "node:fs/promises";
import JSZip from "jszip";
import { analyzeApk } from "./lib/apk.js";
import { injectAssets, signScript } from "./lib/inject.js";
import { buildSampleApk } from "./lib/sample-apk.js";
import { hostProject, adbRecipes } from "./lib/vspace.js";
import { zipFolder } from "./lib/pack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HEX_PORT || process.env.PORT || 8787);
const HOST = process.env.HEX_HOST || "0.0.0.0";

const app = express();
app.disable("x-powered-by");
app.use(
  cors({
    origin: true,
    credentials: false,
  })
);
app.use(express.json({ limit: "8mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 180 * 1024 * 1024 },
});

app.use((req, res, next) => {
  res.setHeader("X-HEX-Engine", "BerasXcorps/1.0.1");
  next();
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.use("/lib", express.static(path.join(__dirname, "lib")));
app.use("/sdk", express.static(path.join(__dirname, "sdk")));
app.use("/templates", express.static(path.join(__dirname, "templates")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "BerasXcorps HEX",
    version: "1.0.1",
    policy: "first-party-only",
    decompile: false,
    ptrace: false,
    virtualApp: false,
  });
});

app.post("/api/apk/analyze", upload.single("apk"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Unggah berkas APK milikmu." });
    const info = await analyzeApk(req.file.buffer, req.file.originalname);
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/api/apk/inject", upload.single("apk"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Unggah APK milikmu." });
    let payload = {};
    if (req.body.payload) {
      payload = typeof req.body.payload === "string" ? JSON.parse(req.body.payload) : req.body.payload;
    }
    if (payload.ownership !== true) {
      return res.status(403).json({
        error: "Inject ditolak. HEX hanya untuk APK yang kamu miliki. Centang surat kepemilikan dulu.",
      });
    }
    const result = await injectAssets(req.file.buffer, payload);
    const name = (req.file.originalname || "app.apk").replace(/\.apk$/i, "") + "-hex-unsigned.apk";
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("X-HEX-Added", result.added.join(","));
    res.setHeader("X-HEX-Removed", result.removed.join(","));
    res.send(result.buffer);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/api/vspace/pack", upload.single("apk"), async (req, res) => {
  try {
    let payload = {};
    if (req.body.payload) {
      payload = typeof req.body.payload === "string" ? JSON.parse(req.body.payload) : req.body.payload;
    }
    if (payload.ownership !== true) {
      return res.status(403).json({ error: "V-Space hanya untuk paket milikmu." });
    }
    const pkg = payload.package || "id.berasxcorps.farm";
    const label = payload.label || pkg;
    const files = hostProject({ pkg, label, overlay: payload.overlay !== false });
    files["scripts/sign.sh"] = signScript("guest-unsigned.apk");
    files["scripts/adb.txt"] = adbRecipes(pkg);
    if (req.file) {
      const inj = await injectAssets(req.file.buffer, { ...payload, virtualSpace: true });
      files["guest/guest-unsigned.apk"] = inj.buffer;
    }
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="hex-vspace-${pkg.replace(/\./g, "-")}.zip"`);
    res.send(buf);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.get("/api/sample/apk", async (_req, res) => {
  const buf = await buildSampleApk();
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", 'attachment; filename="BerasFarm-hex-sample.apk"');
  res.send(buf);
});

app.get("/api/download/webapp", async (_req, res) => {
  const tmp = path.join(__dirname, "tmp", `webapp-${Date.now()}.zip`);
  await zipFolder(path.join(__dirname, "public"), tmp, {
    root: "hex-webapp",
    files: {
      "hex-webapp/README.txt":
        "BerasXcorps HEX Studio (static). Buka index.html lewat server HEX atau http-server.\n",
    },
  });
  res.download(tmp, "HEX-Studio-webapp.zip", async () => {
    await rm(tmp, { force: true });
  });
});

app.get("/api/download/sdk", async (_req, res) => {
  const tmp = path.join(__dirname, "tmp", `sdk-${Date.now()}.zip`);
  await zipFolder(path.join(__dirname, "sdk"), tmp, { root: "hex-sdk" });
  res.download(tmp, "HEX-SDK.zip", async () => {
    await rm(tmp, { force: true });
  });
});

app.get("/api/download/full", async (_req, res) => {
  const tmp = path.join(__dirname, "tmp", `full-${Date.now()}.zip`);
  await zipFolder(__dirname, tmp, { root: "berasxcorps-hex" });
  res.download(tmp, "BerasXcorps-HEX-full.zip", async () => {
    await rm(tmp, { force: true });
  });
});

app.get("/api/download/sign-script", (_req, res) => {
  res.setHeader("Content-Type", "text/x-shellscript");
  res.setHeader("Content-Disposition", 'attachment; filename="hex-sign.sh"');
  res.send(signScript());
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/bridge" });

const clients = new Set();
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://hex.local");
  const meta = {
    pkg: url.searchParams.get("pkg") || "unknown",
    role: url.searchParams.get("role") || "game",
    token: url.searchParams.get("token") || "",
  };
  ws.meta = meta;
  clients.add(ws);
  broadcast(
    { type: "peer", event: "join", pkg: meta.pkg, role: meta.role, at: Date.now() },
    ws
  );
  ws.send(
    JSON.stringify({
      type: "hello",
      engine: "HEX",
      policy: "first-party",
      pkg: meta.pkg,
    })
  );
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    broadcast({ ...msg, _from: meta }, ws);
  });
  ws.on("close", () => {
    clients.delete(ws);
    broadcast({ type: "peer", event: "leave", pkg: meta.pkg, role: meta.role, at: Date.now() });
  });
});

function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const c of clients) {
    if (c !== except && c.readyState === 1) c.send(data);
  }
}

httpServer.listen(PORT, HOST, () => {
  console.log(`HEX Studio  http://${HOST}:${PORT}`);
});
