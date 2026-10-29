# OpenSyog — Multi-OS MySQL/MariaDB/PostgreSQL Client

Database client desktop lintas platform (Windows/macOS/Linux), terinspirasi oleh alur kerja tool SQL client klasik: ringan, cepat, dan berfitur lengkap untuk administrasi database sehari-hari.

## Teknologi

| Lapisan | Pilihan |
|---|---|
| Shell desktop | Tauri 2 (Rust) — Win/macOS/Linux |
| UI | React + TypeScript + Vite |
| Editor SQL | CodeMirror 6 |
| Koneksi DB | Rust: `mysql_async` (MySQL/MariaDB), `tokio-postgres` + `postgres-openssl` (PostgreSQL) |
| SSH tunnel | `russh` |
| SSL/TLS | `openssl` / `rustls` + sertifikat client |
| Scheduler agent | CLI `agent` — job file JSON, dijalankan cron/systemd/Task Scheduler atau daemon bawaan |
| Data UI | kamus keyword & i18n dalam SQLite/JSON |

## Arsitektur

```
+------------------------------------------------------+
| React UI                                             |
|  - Object browser tree | Tab editor | Grid hasil     |
+------------------------------------------------------+
        | Tauri IPC (invoke/events, streaming rows)
+------------------------------------------------------+
| Rust core (per koneksi: worker async + task cancel)  |
|  conn_manager | metadata | query_engine | export     |
|  sync_engine | scheduler | tunnel (SSH/HTTP/SSL)     |
+------------------------------------------------------+
        | mysql_async / tokio-postgres / russh
```

Setiap koneksi berjalan pada worker async sendiri; semua query bisa dibatalkan (tombol Stop), hasil besar di-stream per-chunk ke UI (virtual scroll).

## Layout UI

- Toolbar atas: New/Save query, Execute (F9), Format Query, Refresh (F5), Stop.
- Kiri: **Object browser** (tree): SERVER → DATABASE → TABLES/VIEW/SP/FUNC/TRIGGER/EVENT/INDEX (ikon per objek).
- Tengah: tab editor SQL (multi-tab, syntax highlight, autocomplete dari kamus keyword + metadata live: tabel/kolom), plus tab Manage Table & Schema Designer.
- Bawah: grid hasil query + tab Messages/Info/History.
- Kanan/bawah kursor: tab Table Data (grid editable), Table Info, Index Manager, Related Objects.
- Status bar: koneksi aktif, jumlah baris, waktu eksekusi.
- Dark/light theme.

## Fitur MVP (fasa 1)

1. Connection manager: simpan/hapus koneksi, group, test connect, versi server.
2. Tunnel: direct, SSH (password & key), SSL/TLS.
3. Object browser penuh: create/alter/drop database, table, view, SP, function, trigger, event; rename; truncate; change engine/charset.
4. Editor SQL: multi-tab, autocomplete (keyword + nama objek live), format query, goto line, history, save/open file, execute seleksi/statement.
5. Grid hasil: edit inline (INSERT/UPDATE/DELETE terbentuk otomatis), filter, sort, copy sebagai CSV/TSV/JSON/SQL INSERT, NULL handling, export.
6. Table data grid + pagination server-side.
7. Import/export: CSV, SQL dump, JSON, XML; export SQL terstruktur.
8. User manager & privileges (GRANT/REVOKE UI).
9. Multi-koneksi paralel, multi-tab.
10. Import/export koneksi: kompatibel file `.sycs` SQLyog (password MySQL & SSH di-decode dari format obfuscation base64+rotl1, lalu disimpan aman ke OS keyring).

## Fitur Fasa 2

- Schema Synchronization Tool & Database Synchronization Wizard.
- Scheduled Backup Wizard + SQL Scheduler & Reporting Tool (job file + agent CLI + email report SMTP).
- Import External Data Wizard (ODBC/CSV sumber lain).
- Query Builder visual & Schema Designer (ERD, drag-drop).
- HTTP tunneling, backup terjadwal terkompresi (zstd/gzip).
- Find in database (grep semua tabel/view/SP).
- Power tools: batch table rename/prefix change.

## Struktur Project

```
opensyog/
├── src-tauri/            # Rust core
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/     # handler IPC
│   │   ├── db/           # mysql.rs, postgres.rs, traits
│   │   ├── tunnel/       # ssh.rs, http.rs, ssl.rs
│   │   ├── sync/         # schema_sync.rs, data_sync.rs
│   │   ├── scheduler/    # job.rs, agent.rs
│   │   └── export/       # csv, sql, json
│   └── Cargo.toml
├── src/                  # React UI
│   ├── components/       # ObjectBrowser, SqlEditor, DataGrid, ConnectionDialog, SchemaDesigner
│   ├── stores/           # state (zustand)
│   └── assets/           # ikon tree, tema
└── resources/            # keyword dict, i18n (id/en)
```

## Catatan desain

- Stack UI hybrid klasik (native + HTML renderer) dipadankan ke: React/Tauri + CodeMirror.
- Autocomplete memakai kamus bawaan + metadata live dari server (information_schema/pg_catalog).
- i18n via JSON (id/en dulu).
- Job agent CLI membaca file job JSON terjadwal.
- Ikon objek tree: set ikon SVG buatan sendiri, tanpa menyalin aset pihak ketiga.
- Semua kode dan aset ditulis dari nol; tidak menggunakan biner/resource dari aplikasi lain.
