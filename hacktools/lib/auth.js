import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const APP_VERSION = "1.0.1";
export const OWNER_USER = "reexzyown";
export const OWNER_PASS = "own123";

const users = new Map();
const sessions = new Map();

function hashPass(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function checkPass(password, stored) {
  const [salt, hash] = stored.split(":");
  const next = scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, "hex");
  return next.length === prev.length && timingSafeEqual(next, prev);
}

function token() {
  return randomBytes(24).toString("hex");
}

export function registerUser({ username, password, displayName }) {
  const u = String(username || "").trim().toLowerCase();
  if (u.length < 3) throw new Error("Username minimal 3 karakter.");
  if (u === OWNER_USER) throw new Error("Username cadangan sistem.");
  if (String(password || "").length < 4) throw new Error("Password minimal 4 karakter.");
  if (users.has(u)) throw new Error("Username sudah terpakai.");
  const rec = {
    username: u,
    displayName: displayName || u,
    password: hashPass(password),
    role: "user",
    createdAt: Date.now(),
    version: APP_VERSION,
  };
  users.set(u, rec);
  return issue(rec);
}

export function loginUser({ username, password }) {
  const u = String(username || "").trim().toLowerCase();
  const p = String(password || "");

  if (u === OWNER_USER) {
    if (p !== OWNER_PASS) throw new Error("Kredensial owner salah.");
    const rec = {
      username: OWNER_USER,
      displayName: "Owner Reexzy",
      role: "owner",
      createdAt: Date.now(),
      version: APP_VERSION,
      ephemeral: true,
      note: "Owner login hanya berlaku di ReexzyINJ v1.0.1 dan hangus di versi berikutnya.",
    };
    return issue(rec);
  }

  const rec = users.get(u);
  if (!rec || !checkPass(p, rec.password)) throw new Error("Username atau password salah.");
  return issue(rec);
}

function issue(rec) {
  const t = token();
  const session = {
    token: t,
    username: rec.username,
    displayName: rec.displayName,
    role: rec.role,
    version: APP_VERSION,
    ephemeral: Boolean(rec.ephemeral),
    note: rec.note || null,
    at: Date.now(),
  };
  sessions.set(t, session);
  return session;
}

export function verifyToken(raw) {
  if (!raw) return null;
  const t = String(raw).replace(/^Bearer\s+/i, "").trim();
  return sessions.get(t) || null;
}

export function publicUser(session) {
  if (!session) return null;
  return {
    username: session.username,
    displayName: session.displayName,
    role: session.role,
    version: session.version,
    ephemeral: session.ephemeral,
    note: session.note,
  };
}
