// Build installer semua target OS yang tersedia di mesin ini, lalu copy hasilnya
// ke folder releases/ (untuk di-commit ke git).
// Jalankan: npm run update-releases
//
// Catatan: satu mesin hanya bisa build untuk OS-nya sendiri.
//   Windows -> .exe (NSIS) + .msi
//   macOS   -> .dmg + .app (pkg tidak dibuat default oleh Tauri)
//   Linux   -> .AppImage + .deb
// Build untuk OS lain harus dijalankan di mesin OS tsb (atau CI).
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const bundleDir = join(root, "src-tauri", "target", "release", "bundle");
const outDir = join(root, "releases");

console.log("Building (npm run tauri build)...");
execSync("npm run tauri build", { cwd: root, stdio: "inherit" });

mkdirSync(outDir, { recursive: true });

const wanted = [".exe", ".msi", ".dmg", ".pkg", ".AppImage", ".deb", ".rpm", ".apk"];
let copied = 0;

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (wanted.some((ext) => name.toLowerCase().endsWith(ext))) {
      copyFileSync(p, join(outDir, name));
      console.log("Copied:", name);
      copied++;
    }
  }
};

if (existsSync(bundleDir)) walk(bundleDir);
console.log(copied ? `Selesai: ${copied} file installer di ${outDir}` : "Tidak ada file installer ditemukan.");
