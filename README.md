# OpenSyog

Database client desktop lintas platform (Windows / macOS / Linux) untuk **MySQL, MariaDB, dan PostgreSQL** — dibangun dengan Tauri 2 + React + Rust. Ringan (bundle < 20 MB), cepat, dan berfitur lengkap untuk administrasi database sehari-hari.

![Stack](https://img.shields.io/badge/Tauri-2-blue) ![Rust](https://img.shields.io/badge/Rust-stable-orange) ![React](https://img.shields.io/badge/React-18-61dafb)

---

## Fitur

### Koneksi
- **Multi koneksi paralel** — banyak koneksi MySQL/MariaDB/PostgreSQL aktif bersamaan, tampil sebagai tree per koneksi di sidebar
- **Simpan koneksi** — profil koneksi tersimpan di disk (`%APPDATA%/OpenSyog/connections.json`), password tersimpan aman di **OS keyring** (Windows Credential Manager / macOS Keychain / Linux Secret Service) — tidak pernah ditulis dalam file biasa
- **Edit & hapus koneksi tersimpan** dari welcome screen
- **Test Koneksi** sebelum simpan — connect sementara, tampilkan versi server, lalu tutup
- **SSH tunnel** — koneksi ke database di belakang firewall via SSH, mendukung autentikasi **password** maupun **private key**
- **SSL/TLS** untuk koneksi langsung

### SQL Editor
- **Multi tab query** — buka tab query sebanyak apapun per koneksi (`+` / Ctrl+T)
- **Autocomplete kontekstual**:
  - `namadb.` + titik → daftar **tabel**
  - `tabel.` atau `db.tabel.` + titik → daftar **kolom** (+ `*`)
  - **Alias** dikenali otomatis: `FROM users u` lalu `u.` → kolom users
  - Keyword SQL, nama database, nama tabel, dan alias dalam satu daftar
- Eksekusi dengan **F9** atau tombol Execute
- **Query history** (200 terakhir) di tab bawah dengan tombol Copy
- Error query ditampilkan jelas di panel Result

### Data Grid (Table Data)
- **Edit inline** — double-click cell untuk edit, **autosave saat pindah baris** (Enter / ↑↓ / Tab)
- Tombol **✔ Simpan / ✕ Batal** muncul hanya saat ada perubahan yang belum tersimpan
- Set nilai **NULL** (∅), duplikat baris (⧉), hapus baris (✕)
- **Checkbox baris** — pilih 1 / beberapa / semua → bulk delete
- **Paging** Prev/Next + **limit selector** (100 / 500 / 1000 / 5000 / Semua)
- Deteksi **primary key** otomatis untuk UPDATE/DELETE yang aman

### Relasi (Foreign Key)
- Kolom ber-relasi ditandai **🔗 ikon** di header
- Klik ikon → modal menampilkan **isi tabel sumber** ter-filter dengan nilai baris aktif

### Context Menu (klik kanan)
- **Database**: Refresh, Create Table, Drop Database, Copy Name, Set as Active
- **Tabel**: Open Table, View Structure, **Create Table**, **Alter Table**, **Manage Relations**, **Rename**, **Duplicate**, **Truncate**, **Drop**, Copy as SELECT/INSERT, **Backup/Dump SQL**, **Import CSV**

### Export & Import
- **Export hasil query / tabel** ke **CSV, TSV, JSON, SQL INSERT, HTML** — dengan pilihan sertakan header dan hanya baris terpilih
- **Dump tabel** ke file SQL (DDL + data)
- **Import CSV** ke tabel

---

## Instalasi

### Opsi 1 — Installer (Windows)
Jalankan `OpenSyog_0.1.0_x64-setup.exe` (folder `src-tauri/target/release/bundle/nsis/`) dan ikuti wizard.

### Opsi 2 — Portable
Salin `opensyog.exe` ke folder manapun dan jalankan langsung. Tidak perlu instalasi.

### Build dari source

**Prasyarat:**
- [Node.js](https://nodejs.org) ≥ 20
- [Rust](https://rustup.rs) (stable)
- Windows: [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (sudah bawaan Windows 10/11)
- Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
- macOS: Xcode Command Line Tools

```bash
# install dependensi frontend
npm install

# mode development (hot reload)
npm run tauri dev

# build release
npm run tauri build
```

Hasil build release:
- `src-tauri/target/release/opensyog` (binary portable)
- `src-tauri/target/release/bundle/` (installer per platform)

> **Catatan:** binary di `target/debug` **tidak bisa** dijalankan langsung — mode debug memuat UI dari dev server Vite (`localhost:1420`). Gunakan `npm run tauri dev` atau binary release.

---

## Cara Pakai

1. **Buat koneksi**: klik **New Connection** → pilih tipe DB → isi host/port/user/password → **Test Koneksi** untuk verifikasi → **Simpan & Connect**
2. **SSH tunnel**: centang *Gunakan SSH tunnel* → isi host/port/user SSH → password atau private key → host/port database di atas adalah tujuan **setelah tunnel** (biasanya `127.0.0.1:3306`)
3. **Pilih database** di sidebar kiri → expand **Tables**
4. **Klik tabel** → data tampil di grid bawah, siap diedit (double-click cell)
5. **Query SQL**: ketik di editor atas, tekan **F9** — hasil di panel bawah
6. **Klik kanan** di database/tabel untuk menu lengkap (create, alter, rename, dump, dll)

### Shortcut
| Tombol | Aksi |
|---|---|
| F9 | Eksekusi query |
| Ctrl+T | Tab query baru |
| Ctrl+W | Tutup tab query |
| F5 | Refresh object browser |
| Double-click cell | Edit data |

---

## Penyimpanan Data

| Data | Lokasi | Aman? |
|---|---|---|
| Profil koneksi | `%APPDATA%/OpenSyog/connections.json` | tanpa password |
| Password DB & SSH | OS keyring (service `OpenSyog`) | ✅ encrypted oleh OS |
| Query history | memori (hilang saat close) | — |

---

## Arsitektur

```
opensyog/
├── src/                  # Frontend React + TypeScript
│   ├── App.tsx           # Layout utama
│   ├── store.ts          # State management (Zustand)
│   └── components/
│       ├── ConnectionDialog.tsx   # Dialog koneksi (+ test koneksi, SSH, edit)
│       ├── ObjectBrowser.tsx      # Tree koneksi/database/tabel + context menu
│       ├── SqlEditor.tsx          # CodeMirror multi-tab + autocomplete hierarkis
│       ├── DataGrid.tsx           # Grid editable + relasi + export
│       ├── MenuBar.tsx            # Menu bar (File/Edit/Database/Table/Tools)
│       └── ContextMenu.tsx        # Context menu generik
├── src-tauri/            # Backend Rust (Tauri 2)
│   └── src/
│       ├── main.rs       # IPC commands + connection manager
│       ├── mysql_db.rs   # Driver MySQL/MariaDB (mysql_async)
│       ├── postgres_db.rs# Driver PostgreSQL (tokio-postgres)
│       ├── ssh_tunnel.rs # SSH tunnel (russh, direct-tcpip)
│       ├── saved_conns.rs# Persistensi koneksi + keyring
│       └── transfer.rs   # Dump SQL + import CSV
└── SPEC.md               # Spesifikasi teknis
```

**Kenapa Tauri?** Bundle kecil (<20 MB vs 100+ MB Electron), memori rendah, backend Rust native untuk driver database & SSH — keamanan dan performa terbaik untuk operasi data besar.

---

## Cara Pakai di macOS

### 1. Install prasyarat
```bash
# Xcode Command Line Tools
xcode-select --install

# Homebrew (jika belum ada)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js & Rust
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Build aplikasi
```bash
# install dependensi tambahan yang dibutuhkan Tauri di macOS
brew install create-dmg

cd opensyog
npm install
npm run tauri build
```

Hasil build:
- Binary: `src-tauri/target/release/opensyog`
- App bundle: `src-tauri/target/release/bundle/macos/OpenSyog.app`
- DMG installer: `src-tauri/target/release/bundle/dmg/OpenSyog_0.1.0_aarch64.dmg` (Apple Silicon) atau `..._x64.dmg` (Intel)

### 3. Jalankan
- **Dari App bundle**: drag `OpenSyog.app` ke `/Applications` lalu buka dari Launchpad
- **Dari terminal**: `./src-tauri/target/release/opensyog`
- **Mode development** (hot reload): `npm run tauri dev`

### 4. Catatan keamanan macOS (Gatekeeper)
Karena aplikasi belum di-sign dengan Apple Developer certificate, macOS akan menampilkan peringatan saat pertama dibuka:
- Jika muncul *"OpenSyog cannot be opened because it is from an unidentified developer"*: buka **System Settings → Privacy & Security** → scroll ke bawah → klik **Open Anyway**
- Atau lewat terminal:
  ```bash
  xattr -cr /Applications/OpenSyog.app
  ```
- Untuk distribusi resmi, sign dengan: `codesign --deep --force --sign "Developer ID Application: Nama Anda" OpenSyog.app`

### 5. Koneksi lokal di macOS
- **MySQL/MariaDB**: `brew install mysql` → `brew services start mysql` → host `127.0.0.1`, port `3306`
- **PostgreSQL**: `brew install postgresql@16` → `brew services start postgresql@16` → host `127.0.0.1`, port `5432`
- Password tersimpan aman di **Keychain Access** (item service `OpenSyog`)

### Perbedaan perilaku vs Windows
| Aspek | Windows | macOS |
|---|---|---|
| Keyring | Windows Credential Manager | Keychain Access |
| Config file | `%APPDATA%/OpenSyog/` | `~/Library/Application Support/OpenSyog/` |
| Installer | NSIS/MSI (.exe/.msi) | DMG (.dmg) |
| Menu bar | di dalam window | native (perlu Tauri native menu — saat ini menu ada di dalam window juga) |

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| `Access denied` saat koneksi | Cek user/password; untuk MySQL 8 pastikan plugin `mysql_native_password` atau `caching_sha2_password` didukung |
| SSH tunnel gagal | Pastikan host/port SSH benar; private key harus format OpenSSH (ed25519/RSA) |
| `target/debug/opensyog.exe` blank | Normal — debug butuh dev server. Jalankan `npm run tauri dev` atau pakai build release |
| Query tidak jalan | Pastikan sudah memilih koneksi aktif (chip di atas) dan SQL benar; error tampil di panel Result |
| Tabel tidak muncul | Klik kanan database → Refresh, atau klik nama database |

---

## Roadmap

- [ ] Table designer visual (grid kolom, index, FK drag-drop)
- [ ] User manager & privileges
- [ ] Backup/restore seluruh database (bukan per tabel)
- [ ] Schema sync antar database
- [ ] Saved query / snippet
- [ ] Dark mode

---

## License

MIT
