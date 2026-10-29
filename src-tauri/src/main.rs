use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;

pub mod mysql_db;
pub mod postgres_db;
pub mod saved_conns;
pub mod ssh_tunnel;
pub mod sycs;
pub mod transfer;

use saved_conns::SavedConnection;
use ssh_tunnel::SshTunnel;

/// Parameter koneksi efektif untuk driver (sudah melewati SSH tunnel bila ada).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnParams {
    pub db_type: String, // "mysql" | "postgres"
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: Option<String>,
    #[serde(default)]
    pub ssl: bool,
}

pub enum Conn {
    Mysql(mysql_db::MysqlConn),
    Postgres(postgres_db::PgConn),
}

impl Conn {
    pub async fn query(&mut self, sql: &str) -> Result<QueryResult, String> {
        match self {
            Conn::Mysql(c) => c.query(sql).await,
            Conn::Postgres(c) => c.query(sql).await,
        }
    }
    pub async fn list_databases(&mut self) -> Result<Vec<String>, String> {
        match self {
            Conn::Mysql(c) => c.list_databases().await,
            Conn::Postgres(c) => c.list_databases().await,
        }
    }
    pub async fn list_objects(&mut self, database: &str) -> Result<DbObjects, String> {
        match self {
            Conn::Mysql(c) => c.list_objects(database).await,
            Conn::Postgres(c) => c.list_objects(database).await,
        }
    }
    pub async fn table_columns(&mut self, database: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
        match self {
            Conn::Mysql(c) => c.table_columns(database, table).await,
            Conn::Postgres(c) => c.table_columns(database, table).await,
        }
    }
    pub async fn table_schemas(&mut self, database: &str) -> Result<Vec<TableSchema>, String> {
        match self {
            Conn::Mysql(c) => c.table_schemas(database).await,
            Conn::Postgres(c) => c.table_schemas(database).await,
        }
    }
    pub async fn select_rows(
        &mut self,
        database: &str,
        table: &str,
        limit: u32,
        offset: u32,
    ) -> Result<QueryResult, String> {
        match self {
            Conn::Mysql(c) => c.select_rows(database, table, limit, offset).await,
            Conn::Postgres(c) => c.select_rows(database, table, limit, offset).await,
        }
    }
    pub async fn server_version(&mut self) -> Result<String, String> {
        match self {
            Conn::Mysql(c) => c.server_version().await,
            Conn::Postgres(c) => c.server_version().await,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub rows_affected: u64,
    pub duration_ms: u64,
    pub is_select: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DbObjects {
    pub tables: Vec<String>,
    pub views: Vec<String>,
    pub procedures: Vec<String>,
    pub functions: Vec<String>,
    pub triggers: Vec<String>,
    pub events: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub key: String,
    pub default: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
}

/// Skema lengkap satu database: tabel → kolom + relasi FK (utk autocomplete & ikon relasi).
#[derive(Debug, Clone, Serialize)]
pub struct TableSchema {
    pub table: String,
    #[serde(default)]
    pub table_comment: Option<String>,
    pub columns: Vec<ColumnInfo>,
    /// relasi: kolom ini → tabel_kolom tujuan
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForeignKeyInfo {
    pub column: String,
    pub ref_table: String,
    pub ref_column: String,
}

struct LiveConn {
    conn: Conn,
    tunnel: Option<SshTunnel>,
    /// true bila koneksi dibuat dari profil tersimpan (password via keyring)
    from_saved: bool,
}

type ConnHandle = Arc<Mutex<LiveConn>>;

pub struct AppState {
    pub connections: Mutex<HashMap<String, ConnHandle>>,
}

async fn get_conn(id: &str, state: &State<'_, AppState>) -> Result<ConnHandle, String> {
    state
        .connections
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "Not connected".to_string())
}

/// Buka koneksi dari parameter ad-hoc (dialog langsung, password eksplisit).
#[tauri::command]
async fn connect(
    id: String,
    params: ConnParams,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut params = params;
    let tunnel = open_ssh_if_any(&mut params).await?;
    let mut conn = create_conn(&params).await?;
    let version = conn.server_version().await?;
    state.connections.lock().await.insert(
        id,
        Arc::new(Mutex::new(LiveConn { conn, tunnel, from_saved: false })),
    );
    Ok(version)
}

/// Buka koneksi dari profil tersimpan; password diambil dari keyring.
#[tauri::command]
async fn connect_saved(
    id: String,
    saved_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let saved = saved_conns::resolve(&saved_id)
        .ok_or_else(|| format!("Connection profile not found: {saved_id}"))?;

    let mut params = ConnParams {
        db_type: saved.db_type.clone(),
        host: saved.host.clone(),
        port: saved.port,
        user: saved.user.clone(),
        password: saved_conns::get_password(&saved_id).unwrap_or_default(),
        database: saved.database.clone(),
        ssl: saved.ssl,
    };

    let tunnel = if let Some(ssh) = &saved.ssh {
        let t = ssh_tunnel::open_tunnel(ssh, &params.host, params.port).await?;
        params.host = "127.0.0.1".into();
        params.port = t.local_port;
        Some(t)
    } else {
        None
    };

    let mut conn = create_conn(&params).await?;
    let version = conn.server_version().await?;
    state.connections.lock().await.insert(
        id,
        Arc::new(Mutex::new(LiveConn { conn, tunnel, from_saved: true })),
    );
    Ok(version)
}

async fn create_conn(params: &ConnParams) -> Result<Conn, String> {
    match params.db_type.as_str() {
        "mysql" => Ok(Conn::Mysql(mysql_db::MysqlConn::connect(params).await?)),
        "postgres" => Ok(Conn::Postgres(postgres_db::PgConn::connect(params).await?)),
        other => Err(format!("Unsupported database type: {other}")),
    }
}

async fn open_ssh_if_any(params: &mut ConnParams) -> Result<Option<SshTunnel>, String> {
    Ok(None) // ad-hoc tanpa SSH untuk sekarang; SSH ad-hoc via connect_saved
}

/// Test koneksi tanpa menyimpan: connect → ambil versi server → drop.
#[tauri::command]
async fn test_connection(params: ConnParams) -> Result<String, String> {
    let mut conn = create_conn(&params).await?;
    let version = conn.server_version().await?;
    Ok(version)
}

#[tauri::command]
async fn disconnect(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let removed = state.connections.lock().await.remove(&id);
    if let Some(handle) = removed {
        let mut live = handle.lock().await;
        if let Some(t) = live.tunnel.take() {
            t.abort();
        }
    }
    Ok(())
}

#[tauri::command]
async fn execute(
    id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let conn = get_conn(&id, &state).await?;
    let out = conn.lock().await.conn.query(&sql).await;
    out
}

#[tauri::command]
async fn list_databases(id: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = get_conn(&id, &state).await?;
    let out = conn.lock().await.conn.list_databases().await;
    out
}

#[tauri::command]
async fn list_objects(
    id: String,
    database: String,
    state: State<'_, AppState>,
) -> Result<DbObjects, String> {
    let conn = get_conn(&id, &state).await?;
    let out = conn.lock().await.conn.list_objects(&database).await;
    out
}

/// Skema lengkap (kolom semua tabel + FK) untuk autocomplete & ikon relasi.
#[tauri::command]
async fn get_schema(
    id: String,
    database: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableSchema>, String> {
    let conn = get_conn(&id, &state).await?;
    let out = conn.lock().await.conn.table_schemas(&database).await;
    out
}

#[tauri::command]
async fn table_columns(
    id: String,
    database: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnInfo>, String> {
    let conn = get_conn(&id, &state).await?;
    let out = conn.lock().await.conn.table_columns(&database, &table).await;
    out
}

#[tauri::command]
async fn select_rows(
    id: String,
    database: String,
    table: String,
    limit: u32,
    offset: u32,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let conn = get_conn(&id, &state).await?;
    let out = conn
        .lock()
        .await
        .conn
        .select_rows(&database, &table, limit, offset)
        .await;
    out
}

// ===================== persistensi koneksi =====================

#[tauri::command]
fn list_saved_connections() -> Vec<SavedConnection> {
    saved_conns::list()
}

#[tauri::command]
fn save_connection(conn: SavedConnection) -> Result<(), String> {
    saved_conns::save(&conn)
}

#[tauri::command]
fn delete_connection(id: String) -> Result<(), String> {
    saved_conns::delete(&id)
}

#[tauri::command]
fn store_connection_password(id: String, password: String) -> Result<(), String> {
    saved_conns::store_password(&id, &password)
}

#[tauri::command]
fn has_saved_password(id: String) -> bool {
    saved_conns::get_password(&id).is_some()
}

// ===================== import/export koneksi (.sycs SQLyog-compatible) =====================

/// Baca file .sycs → daftar koneksi (password sudah di-decode, hanya utk preview).
#[tauri::command]
fn sycs_parse(path: String) -> Result<Vec<sycs::SycsEntry>, String> {
    sycs::parse_sycs(&path)
}

/// Import koneksi terpilih dari .sycs ke daftar koneksi tersimpan (+ keyring).
#[tauri::command]
fn sycs_import(path: String, indexes: Vec<usize>) -> Result<usize, String> {
    let entries = sycs::parse_sycs(&path)?;
    let mut imported = 0;
    for idx in indexes {
        if let Some(e) = entries.get(idx) {
            let mut conn = sycs::sycs_to_saved(e);
            // hindari nama duplikat: tambahkan suffix bila sudah ada
            let existing = saved_conns::list();
            if existing.iter().any(|c| c.name == conn.name) {
                conn.name = format!("{} (imported)", conn.name);
            }
            let pw = e.password.clone();
            let ssh_pw = conn.ssh.as_ref().and_then(|s| s.password.clone());
            saved_conns::save(&conn)?;
            if !pw.is_empty() {
                let _ = saved_conns::store_password(&conn.id, &pw);
            }
            // password SSH juga disimpan ke keyring dengan key terpisah
            if let (Some(s), Some(spw)) = (conn.ssh, ssh_pw) {
                if let Ok(entry) = keyring::Entry::new("OpenSyog", &format!("conn-{}-ssh", conn.id)) {
                    let _ = entry.set_password(&spw);
                }
                // simpan kembali ssh tanpa password plaintext? SSH password di keyring terpisah
                let mut s2 = s;
                s2.password = None;
                conn.ssh = Some(s2);
                saved_conns::save(&conn)?;
            }
            imported += 1;
        }
    }
    Ok(imported)
}

/// Export koneksi terpilih ke file .sycs (password diambil dari keyring).
#[tauri::command]
fn sycs_export(ids: Vec<String>, path: String) -> Result<usize, String> {
    let all = saved_conns::list();
    let mut conns = Vec::new();
    let mut passwords = Vec::new();
    for id in ids {
        if let Some(c) = all.iter().find(|c| c.id == id) {
            let mut c = c.clone();
            let pw = saved_conns::get_password(&c.id).unwrap_or_default();
            // ambil password SSH dari keyring terpisah bila ada
            if let Some(s) = c.ssh.as_mut() {
                if s.password.is_none() {
                    if let Ok(entry) = keyring::Entry::new("OpenSyog", &format!("conn-{}-ssh", c.id)) {
                        if let Ok(p) = entry.get_password() {
                            s.password = Some(p);
                        }
                    }
                }
            }
            conns.push(c);
            passwords.push(pw);
        }
    }
    sycs::export_sycs(&conns, &passwords, &path)?;
    Ok(conns.len())
}

// ===================== dump / import =====================

#[tauri::command]
async fn dump_table(
    id: String,
    database: String,
    table: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let conn = get_conn(&id, &state).await?;
    let is_mysql = matches!(conn.lock().await.conn, Conn::Mysql(_));
    let out = {
        let mut live = conn.lock().await;
        transfer::dump_table(&mut live.conn, &database, &table, &path, is_mysql).await
    };
    out
}

#[tauri::command]
async fn import_csv(
    id: String,
    database: String,
    table: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    let conn = get_conn(&id, &state).await?;
    let is_mysql = matches!(conn.lock().await.conn, Conn::Mysql(_));
    let out = {
        let mut live = conn.lock().await;
        transfer::import_csv(&mut live.conn, &database, &table, &path, is_mysql).await
    };
    out
}

fn main() {
    run()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            connections: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            connect_saved,
            test_connection,
            disconnect,
            execute,
            list_databases,
            list_objects,
            get_schema,
            table_columns,
            select_rows,
            list_saved_connections,
            save_connection,
            delete_connection,
            store_connection_password,
            has_saved_password,
            sycs_parse,
            sycs_import,
            sycs_export,
            dump_table,
            import_csv,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
