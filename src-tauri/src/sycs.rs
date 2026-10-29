//! Import/export koneksi SQLyog (.sycs).
//! Format .sycs = INI per [Connection N]; password di-obfuscate:
//! base64 → XOR rotl1 per byte (rotasi bit kiri 1 bit).

use base64::Engine;
use serde::Serialize;
use std::fs;

use super::saved_conns::{SshParams, SavedConnection};

fn rotl1(b: u8) -> u8 {
    b.rotate_left(1)
}

fn decode_password(enc: &str) -> String {
    if enc.is_empty() {
        return String::new();
    }
    match base64::engine::general_purpose::STANDARD.decode(enc) {
        Ok(bytes) => bytes.iter().map(|&b| rotl1(b) as char).collect(),
        Err(_) => String::new(),
    }
}

fn encode_password(plain: &str) -> String {
    let bytes: Vec<u8> = plain.bytes().map(rotl1).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Koneksi ter-parse dari file .sycs (belum disimpan).
#[derive(Debug, Serialize)]
pub struct SycsEntry {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub ssh: bool,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub ssh_password: String,
}

fn parse_ini(text: &str) -> Vec<Vec<(String, String)>> {
    let mut sections: Vec<Vec<(String, String)>> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            sections.push(Vec::new());
        } else if let Some((k, v)) = line.split_once('=') {
            if let Some(last) = sections.last_mut() {
                last.push((k.trim().to_lowercase(), v.to_string()));
            }
        }
    }
    sections
}

fn get(sec: &[(String, String)], key: &str) -> String {
    sec.iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

fn to_entry(sec: &[(String, String)]) -> Option<SycsEntry> {
    let name = get(sec, "name");
    if name.is_empty() {
        return None;
    }
    Some(SycsEntry {
        name: name.clone(),
        host: get(sec, "host"),
        port: get(sec, "port").parse().unwrap_or(3306),
        user: get(sec, "user"),
        password: decode_password(&get(sec, "password")),
        ssh: get(sec, "ssh") == "1",
        ssh_host: get(sec, "sshhost"),
        ssh_port: get(sec, "sshport").parse().unwrap_or(22),
        ssh_user: get(sec, "sshuser"),
        ssh_password: decode_password(&get(sec, "sshpwd")),
    })
}

/// Parse file .sycs → daftar koneksi.
pub fn parse_sycs(path: &str) -> Result<Vec<SycsEntry>, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("Gagal baca file: {e}"))?;
    Ok(parse_ini(&text)
        .iter()
        .filter_map(|sec| to_entry(sec))
        .collect())
}

/// Konversi entry .sycs → SavedConnection (id baru, save_password = true).
pub fn sycs_to_saved(e: &SycsEntry) -> SavedConnection {
    SavedConnection {
        id: uuid::Uuid::new_v4().to_string(),
        name: e.name.clone(),
        db_type: "mysql".into(), // SQLyog hanya MySQL/MariaDB
        host: e.host.clone(),
        port: e.port,
        user: e.user.clone(),
        database: None,
        ssl: false,
        save_password: true,
        ssh: if e.ssh && !e.ssh_host.is_empty() {
            Some(SshParams {
                host: e.ssh_host.clone(),
                port: e.ssh_port,
                user: e.ssh_user.clone(),
                password: if e.ssh_password.is_empty() { None } else { Some(e.ssh_password.clone()) },
                private_key_path: None,
            })
        } else {
            None
        },
    }
}

/// Simpan daftar SavedConnection ke file .sycs (password di-obfuscate ala SQLyog).
pub fn export_sycs(conns: &[SavedConnection], passwords: &[String], path: &str) -> Result<(), String> {
    let mut out = String::new();
    for (i, c) in conns.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(&format!("[Connection {}]\n", i + 1));
        out.push_str(&format!("Name={}\n", c.name));
        out.push_str(&format!("Host={}\n", c.host));
        out.push_str(&format!("User={}\n", c.user));
        out.push_str("StorePassword=1\n");
        let pw = passwords.get(i).cloned().unwrap_or_default();
        out.push_str(&format!("Password={}\n", encode_password(&pw)));
        out.push_str(&format!("Port={}\n", c.port));
        out.push_str("Database=\n");
        out.push_str("compressedprotocol=0\n");
        out.push_str("readonly=0\n");
        out.push_str("Tunnel=0\n");
        let ssh = c.ssh.as_ref();
        out.push_str(&format!("SSH={}\n", if ssh.is_some() { 1 } else { 0 }));
        if let Some(s) = ssh {
            out.push_str(&format!("SshUser={}\n", s.user));
            out.push_str(&format!(
                "SshPwd={}\n",
                encode_password(s.password.as_deref().unwrap_or(""))
            ));
            out.push_str(&format!("SshHost={}\n", s.host));
            out.push_str(&format!("SshPort={}\n", s.port));
            out.push_str(&format!("SshForHost={}\n", s.port));
            out.push_str("SshPasswordRadio=1\n");
            out.push_str("SshPrivateRadio=0\n");
            out.push_str("SshSavePassword=1\n");
        } else {
            out.push_str("SshUser=\nSshPwd=\nSshHost=\nSshPort=22\nSshForHost=22\nSshPasswordRadio=1\nSshPrivateRadio=0\nSshSavePassword=0\n");
        }
        out.push_str("SslChecked=0\n");
    }
    fs::write(path, out).map_err(|e| format!("Gagal tulis file: {e}"))
}
