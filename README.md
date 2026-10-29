# OpenSyog

**[Bahasa Indonesia](#bahasa-indonesia) | [English](#english)**

---

<a id="bahasa-indonesia"></a>

## Bahasa Indonesia

Database client desktop lintas platform (Windows / macOS / Linux) untuk **MySQL, MariaDB, dan PostgreSQL** — dibangun dengan Tauri 2 + React + Rust. Ringan (installer < 6 MB), cepat, dan berfitur lengkap untuk administrasi database sehari-hari.

![Stack](https://img.shields.io/badge/Tauri-2-blue) ![Rust](https://img.shields.io/badge/Rust-stable-orange) ![React](https://img.shields.io/badge/React-18-61dafb)

---

### Instalasi Cepat (Tanpa Build)

File installer siap pakai tersedia di folder [`releases/`](releases/) di repo ini — tinggal download sesuai OS:

| OS | File | Catatan |
|---|---|---|
| **Windows** | `releases/OpenSyog_x.y.z_x64-setup.exe` | Installer wizard (rekomendasi) |
| **Windows** | `releases/OpenSyog_x.y.z_x64_en-US.msi` | Alternatif MSI untuk deployment enterprise |
| **macOS** | `releases/OpenSyog_x.y.z_aarch64.dmg` | Apple Silicon (M1/M2/M3) |
| **macOS** | `releases/OpenSyog_x.y.z_x64.dmg` | Intel |
| **Linux** | `releases/OpenSyog_x.y.z_amd64.AppImage` / `.deb` | AppImage portable, .deb untuk Debian/Ubuntu |

> **Catatan:** installer macOS/Linux dibangun di mesin masing-masing OS (lihat [Build dari Source](#build-dari-source-id)). Jika file belum tersedia di `releases/`, build sendiri dengan `npm run tauri build` — hanya butuh 5–10 menit.

**Cara install (user awam):**
1. Download file installer dari folder `releases/` (klik file → tombol **Download**)
2. **Windows**: double-click file `.exe` → jika muncul *"Windows protected your PC"* (SmartScreen, karena belum ada code signing), klik **More info → Run anyway** → ikuti wizard → selesai, OpenSyog muncul di Start Menu
3. **macOS**: double-click `.dmg` → drag **OpenSyog.app** ke folder **Applications** → buka dari Launchpad. Jika muncul peringatan *"unidentified developer"*: **System Settings → Privacy & Security → Open Anyway**
4. **Linux**: `.AppImage` — beri permission execute (`chmod +x OpenSyog_*.AppImage`) lalu double-click; `.deb` — install via `sudo dpkg -i OpenSyog_*.deb` atau double-click di file manager

---

### Fitur

#### Koneksi
- **Multi koneksi paralel** — banyak koneksi MySQL/MariaDB/PostgreSQL aktif bersamaan, tampil sebagai tree per koneksi di sidebar
- **Simpan koneksi** — profil tersimpan di disk (`%APPDATA%/OpenSyog/connections.json`), password aman di **OS keyring** (Windows Credential Manager / macOS Keychain / Linux Secret Service)
- **Edit & hapus koneksi tersimpan** — password otomatis terisi kembali (prefill) saat edit
- **Test Koneksi** — membuka SSH tunnel (bila diaktifkan) lalu connect DB; pesan sukses menampilkan status SSH & versi server
- **Modal Connect** — saat sudah terkoneksi, tombol New Connection menampilkan daftar saved connections + opsi buat baru
- **SSH tunnel** — password maupun private key; mendukung server SSH lama (algoritma legacy SHA1/RSA/CBC tetap didukung)
- **SSL/TLS** untuk koneksi langsung
- **Import koneksi dari SQLyog (.sycs)** — checklist per koneksi; password MySQL & SSH otomatis di-decode lalu disimpan ke OS keyring
- **Export koneksi ke .sycs** — kompatibel dua arah dengan SQLyog

#### SQL Editor
- Multi tab query per koneksi (`+` / Ctrl+T), eksekusi **F9**
- **Autocomplete kontekstual**: `db.` → tabel; `tabel.` / `db.tabel.` → kolom; **alias** dikenali otomatis (`FROM users u` → `u.` → kolom users)
- Query history (200 terakhir) dengan tombol Copy

#### Data Grid
- **Edit inline** double-click cell, autosave saat pindah baris
- Set NULL, duplikat baris, hapus baris, bulk delete via checkbox
- Paging + limit selector (100–5000 / Semua), deteksi primary key otomatis
- Kolom ber-relasi (FK) ditandai 🔗 — klik untuk lihat isi tabel sumber ter-filter

#### Menu Context (klik kanan)
- **Database**: Refresh, Create Table, Drop, Copy Name, Set as Active
- **Tabel**: Open, Structure, Create/Alter Table, Manage Relations, Rename, Duplicate, Truncate, Drop, Copy as SELECT/INSERT, **Backup/Dump SQL**, **Import CSV**

#### Export & Import
- Export query/tabel ke **CSV, TSV, JSON, SQL INSERT, HTML**
- Dump tabel ke file SQL (DDL + data), import CSV ke tabel

---

### Cara Pakai

1. **Buat koneksi**: klik **New Connection** → isi host/port/user/password → **Test Koneksi** → **Simpan & Connect**
2. **SSH tunnel**: centang *Gunakan SSH tunnel* → host/port database = tujuan **setelah tunnel** (biasanya `127.0.0.1:3306`)
3. **Pilih database** di sidebar kiri → expand **Tables** → klik tabel untuk lihat data
4. **Query SQL**: ketik di editor, tekan **F9**
5. **Import koneksi dari SQLyog**: **Tools → Import Koneksi (SQLyog .sycs)…** → pilih file → checklist → **Import**
6. **Export koneksi**: **Tools → Export Koneksi (.sycs)…**

| Shortcut | Aksi |
|---|---|
| F9 | Eksekusi query |
| Ctrl+T / Ctrl+W | Tab baru / tutup tab |
| F5 | Refresh object browser |

---

### <a id="build-dari-source-id"></a>Build dari Source

**Prasyarat:** [Node.js](https://nodejs.org) ≥ 20, [Rust](https://rustup.rs) stable, dan platform-specific (Windows: VS C++ Build Tools + WebView2; Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`; macOS: Xcode CLT).

```bash
npm install
npm run tauri dev      # development (hot reload)
npm run tauri build    # release + installer
npm run update-releases # build lalu copy installer ke folder releases/
```

Hasil build: `src-tauri/target/release/bundle/` (installer per platform).

> **Penting:** hanya jalankan binary dari `target/release` atau hasil installer. Binary `target/debug` / `cargo build` tidak bisa jalan sendiri (butuh dev server Vite) — jika muncul `ERR_CONNECTION_REFUSED`, artinya Anda menjalankan binary yang salah.

**Update file installer di repo:** setiap ada perubahan kode, jalankan `npm run update-releases` lalu commit folder `releases/` — jadi pengguna lain langsung bisa download installer terbaru tanpa build sendiri.

---

### Penyimpanan Data

| Data | Lokasi |
|---|---|
| Profil koneksi | `%APPDATA%/OpenSyog/connections.json` (Windows) / `~/Library/Application Support/OpenSyog/` (macOS) / `~/.config/OpenSyog/` (Linux) |
| Password DB & SSH | OS keyring (service `OpenSyog`) — terenkripsi oleh OS |
| Query history | memori (hilang saat close) |

---

### Troubleshooting

| Masalah | Solusi |
|---|---|
| `ERR_CONNECTION_REFUSED` | Anda menjalankan binary debug/salah — pakai installer dari `releases/` atau `npm run tauri build` |
| SmartScreen memblokir install | **More info → Run anyway** (belum ada code signing) |
| macOS "unidentified developer" | **System Settings → Privacy & Security → Open Anyway** |
| SSH tunnel gagal | Cek host/port; key harus format OpenSSH; server sangat lama mungkin pakai KEX yang tidak didukung |
| Tabel tidak muncul | Klik kanan database → Refresh |

---
---

<a id="english"></a>

## English

A cross-platform desktop database client (Windows / macOS / Linux) for **MySQL, MariaDB, and PostgreSQL** — built with Tauri 2 + React + Rust. Lightweight (installer < 6 MB), fast, and full-featured for daily database administration.

---

### Quick Install (No Build Required)

Ready-to-use installers are available in the [`releases/`](releases/) folder in this repo — just download the one for your OS:

| OS | File | Notes |
|---|---|---|
| **Windows** | `releases/OpenSyog_x.y.z_x64-setup.exe` | Wizard installer (recommended) |
| **Windows** | `releases/OpenSyog_x.y.z_x64_en-US.msi` | MSI alternative for enterprise deployment |
| **macOS** | `releases/OpenSyog_x.y.z_aarch64.dmg` | Apple Silicon (M1/M2/M3) |
| **macOS** | `releases/OpenSyog_x.y.z_x64.dmg` | Intel |
| **Linux** | `releases/OpenSyog_x.y.z_amd64.AppImage` / `.deb` | AppImage portable, .deb for Debian/Ubuntu |

> **Note:** macOS/Linux installers are built on their respective OS machines (see [Build from Source](#build-from-source-en)). If a file is not yet in `releases/`, build it yourself with `npm run tauri build` — takes only 5–10 minutes.

**How to install (beginners):**
1. Download the installer from the `releases/` folder (click the file → **Download** button)
2. **Windows**: double-click the `.exe` → if *"Windows protected your PC"* appears (SmartScreen, no code signing yet), click **More info → Run anyway** → follow the wizard → done, OpenSyog appears in the Start Menu
3. **macOS**: double-click `.dmg` → drag **OpenSyog.app** into **Applications** → open from Launchpad. If an *"unidentified developer"* warning appears: **System Settings → Privacy & Security → Open Anyway**
4. **Linux**: `.AppImage` — make it executable (`chmod +x OpenSyog_*.AppImage`) then double-click; `.deb` — install via `sudo dpkg -i OpenSyog_*.deb` or double-click in your file manager

---

### Features

#### Connections
- **Multiple parallel connections** — many MySQL/MariaDB/PostgreSQL connections active simultaneously, shown as a tree per connection in the sidebar
- **Saved connections** — profiles stored on disk, passwords securely stored in the **OS keyring** (Windows Credential Manager / macOS Keychain / Linux Secret Service)
- **Edit & delete saved connections** — passwords are automatically prefilled when editing
- **Test Connection** — opens the SSH tunnel (when enabled) then connects to the DB; success message shows SSH status & server version
- **Connect modal** — when already connected, the New Connection button shows the saved connections list plus a create-new option
- **SSH tunnel** — password or private key; supports legacy SSH servers (SHA1/RSA/CBC algorithms)
- **SSL/TLS** for direct connections
- **Import connections from SQLyog (.sycs)** — per-connection checklist; MySQL & SSH passwords auto-decoded and stored in the OS keyring
- **Export connections to .sycs** — two-way compatible with SQLyog

#### SQL Editor
- Multi query tabs per connection (`+` / Ctrl+T), execute with **F9**
- **Contextual autocomplete**: `db.` → tables; `table.` / `db.table.` → columns; **aliases** recognized automatically (`FROM users u` → `u.` → users columns)
- Query history (last 200) with Copy button

#### Data Grid
- **Inline editing** via double-click, autosave on row change
- Set NULL, duplicate row, delete row, bulk delete via checkboxes
- Paging + limit selector (100–5000 / All), automatic primary key detection
- Foreign key columns marked with 🔗 — click to view the filtered source table

#### Context Menus (right-click)
- **Database**: Refresh, Create Table, Drop, Copy Name, Set as Active
- **Table**: Open, Structure, Create/Alter Table, Manage Relations, Rename, Duplicate, Truncate, Drop, Copy as SELECT/INSERT, **Backup/Dump SQL**, **Import CSV**

#### Export & Import
- Export query/table results to **CSV, TSV, JSON, SQL INSERT, HTML**
- Dump tables to SQL files (DDL + data), import CSV into tables

---

### Usage

1. **Create a connection**: click **New Connection** → fill in host/port/user/password → **Test Connection** → **Save & Connect**
2. **SSH tunnel**: check *Use SSH tunnel* → the DB host/port above is the target **after the tunnel** (usually `127.0.0.1:3306`)
3. **Select a database** in the left sidebar → expand **Tables** → click a table to view data
4. **SQL queries**: type in the editor, press **F9**
5. **Import connections from SQLyog**: **Tools → Import Connections (SQLyog .sycs)…** → pick a file → checklist → **Import**
6. **Export connections**: **Tools → Export Connections (.sycs)…**

| Shortcut | Action |
|---|---|
| F9 | Execute query |
| Ctrl+T / Ctrl+W | New tab / close tab |
| F5 | Refresh object browser |

---

### <a id="build-from-source-en"></a>Build from Source

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 20, [Rust](https://rustup.rs) stable, plus platform-specific deps (Windows: VS C++ Build Tools + WebView2; Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`; macOS: Xcode CLT).

```bash
npm install
npm run tauri dev      # development (hot reload)
npm run tauri build    # release + installers
npm run update-releases # build then copy installers to releases/
```

Build output: `src-tauri/target/release/bundle/` (per-platform installers).

> **Important:** only run binaries from `target/release` or the installers. The `target/debug` / `cargo build` binary cannot run standalone (it needs the Vite dev server) — if you see `ERR_CONNECTION_REFUSED`, you're running the wrong binary.

**Updating installers in the repo:** after any code change, run `npm run update-releases` and commit the `releases/` folder — so other users can download the latest installer without building it themselves.

---

### Data Storage

| Data | Location |
|---|---|
| Connection profiles | `%APPDATA%/OpenSyog/connections.json` (Windows) / `~/Library/Application Support/OpenSyog/` (macOS) / `~/.config/OpenSyog/` (Linux) |
| DB & SSH passwords | OS keyring (service `OpenSyog`) — encrypted by the OS |
| Query history | memory (lost on close) |

---

### Troubleshooting

| Problem | Solution |
|---|---|
| `ERR_CONNECTION_REFUSED` | You're running a debug/wrong binary — use the installer from `releases/` or `npm run tauri build` |
| SmartScreen blocks install | **More info → Run anyway** (no code signing yet) |
| macOS "unidentified developer" | **System Settings → Privacy & Security → Open Anyway** |
| SSH tunnel fails | Check host/port; key must be OpenSSH format; very old servers may use unsupported KEX |
| Tables don't appear | Right-click database → Refresh |

---

## License

MIT
