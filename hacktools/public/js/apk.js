export async function analyzeApk(file) {
  const fd = new FormData();
  fd.append("apk", file, file.name);
  const res = await fetch("/api/apk/analyze", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal menganalisis APK");
  return data;
}

export async function injectApk(file, payload) {
  const fd = new FormData();
  fd.append("apk", file, file.name);
  fd.append("payload", JSON.stringify(payload));
  const res = await fetch("/api/apk/inject", { method: "POST", body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Inject ditolak");
  }
  const blob = await res.blob();
  return {
    blob,
    added: res.headers.get("X-HEX-Added") || "",
    removed: res.headers.get("X-HEX-Removed") || "",
    name: (file.name || "app.apk").replace(/\.apk$/i, "") + "-hex-unsigned.apk",
  };
}

export async function packVspace(file, payload) {
  const fd = new FormData();
  if (file) fd.append("apk", file, file.name);
  fd.append("payload", JSON.stringify(payload));
  const res = await fetch("/api/vspace/pack", { method: "POST", body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Gagal merakit V-Space");
  }
  return res.blob();
}

export async function health() {
  const res = await fetch("/api/health");
  return res.json();
}
