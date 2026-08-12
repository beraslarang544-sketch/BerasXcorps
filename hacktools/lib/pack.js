import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

export function zipFolder(sourceDir, outFile, extra = {}) {
  return new Promise(async (resolve, reject) => {
    await mkdir(path.dirname(outFile), { recursive: true });
    const output = createWriteStream(outFile);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve({ bytes: archive.pointer(), file: outFile }));
    archive.on("error", reject);
    archive.pipe(output);
    archive.glob(
      "**/*",
      {
        cwd: sourceDir,
        ignore: extra.ignore || ["node_modules/**", "tmp/**", ".git/**"],
        dot: false,
      },
      extra.root ? { prefix: extra.root } : {}
    );
    if (extra.files) {
      for (const [name, content] of Object.entries(extra.files)) {
        archive.append(content, { name });
      }
    }
    archive.finalize();
  });
}

export function zipBuffers(files, outFile) {
  return new Promise(async (resolve, reject) => {
    await mkdir(path.dirname(outFile), { recursive: true });
    const output = createWriteStream(outFile);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve({ bytes: archive.pointer(), file: outFile }));
    archive.on("error", reject);
    archive.pipe(output);
    for (const [name, content] of Object.entries(files)) {
      archive.append(content, { name });
    }
    archive.finalize();
  });
}
