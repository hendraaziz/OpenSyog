use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Profil koneksi tersimpan. Password tidak pernah masuk file ini.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub db_type: String, // "mysql" | "postgres"
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub ssl: bool,
    #[serde(default)]
    pub save_password: bool,
    #[serde(default)]
    pub ssh: Option<SshParams>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshParams {
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
}

fn config_file() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("OpenSyog");
    let _ = fs::create_dir_all(&dir);
    dir.join("connections.json")
}

fn entry_for(id: &str) -> Result<Entry, String> {
    Entry::new("OpenSyog", &format!("conn-{id}")).map_err(|e| e.to_string())
}

pub fn list() -> Vec<SavedConnection> {
    let path = config_file();
    if !path.exists() {
        return Vec::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_all(conns: &[SavedConnection]) -> Result<(), String> {
    let path = config_file();
    let json = serde_json::to_string_pretty(conns).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn save(conn: &SavedConnection) -> Result<(), String> {
    let mut conns = list();
    match conns.iter_mut().find(|c| c.id == conn.id) {
        Some(existing) => *existing = conn.clone(),
        None => conns.push(conn.clone()),
    }
    save_all(&conns)?;
    // sinkronkan keyring: hapus bila tidak mau disimpan
    if !conn.save_password {
        if let Ok(e) = entry_for(&conn.id) {
            let _ = e.delete_credential();
        }
    }
    Ok(())
}

pub fn delete(id: &str) -> Result<(), String> {
    let mut conns = list();
    conns.retain(|c| c.id != id);
    let _ = save_all(&conns)?;
    if let Ok(e) = entry_for(id) {
        let _ = e.delete_credential();
    }
    Ok(())
}

pub fn store_password(id: &str, password: &str) -> Result<(), String> {
    entry_for(id)?
        .set_password(password)
        .map_err(|e| e.to_string())
}

pub fn get_password(id: &str) -> Option<String> {
    entry_for(id).ok().and_then(|e| e.get_password().ok())
}

/// Ambil profil untuk connect: password dari keyring.
pub fn resolve(id: &str) -> Option<SavedConnection> {
    list().into_iter().find(|c| c.id == id)
}
