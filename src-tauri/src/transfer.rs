use super::Conn;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};

macro_rules! wtry {
    ($e:expr) => {
        $e.map_err(|e: std::io::Error| e.to_string())?
    };
}

/// Dump satu tabel ke file SQL (CREATE + INSERT).
/// Berbasis information_schema untuk DDL sederhana + SELECT semua baris.
pub async fn dump_table(
    conn: &mut Conn,
    database: &str,
    table: &str,
    path: &str,
    is_mysql: bool,
) -> Result<u64, String> {
    let q = |name: &str| if is_mysql { format!("`{name}`") } else { format!("\"{name}\"") };
    let fq = format!("{}.{}", q(database), q(table));

    // DDL via SHOW CREATE TABLE (MySQL) atau information_schema (PG)
    let ddl = if is_mysql {
        let r = conn
            .query(&format!("SHOW CREATE TABLE {fq}"))
            .await?;
        r.rows
            .first()
            .and_then(|row| row.get(1))
            .map(|v| v.as_str().unwrap_or("").to_string())
            .unwrap_or_default()
    } else {
        format!("-- DDL untuk {table}: gunakan pg_dump untuk hasil akurat")
    };

    let rows = conn
        .query(&format!("SELECT * FROM {fq}"))
        .await?;

    let mut out = File::create(path).map_err(|e| e.to_string())?;
    wtry!(writeln!(out, "-- OpenSyog dump: {fq}"));
    wtry!(writeln!(out, "-- rows: {}", rows.rows.len()));
    if !ddl.is_empty() {
        wtry!(writeln!(out, "DROP TABLE IF EXISTS {fq};"));
        wtry!(writeln!(out, "{ddl};"));
    }

    let quote_v = |v: &serde_json::Value| -> String {
        match v {
            serde_json::Value::Null => "NULL".into(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
            other => format!("'{}'", other.as_str().unwrap_or("").replace('\'', "''")),
        }
    };

    let cols = rows.columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
    for row in &rows.rows {
        let vals = row.iter().map(quote_v).collect::<Vec<_>>().join(", ");
        wtry!(writeln!(out, "INSERT INTO {fq} ({cols}) VALUES ({vals});"));
    }
    Ok(rows.rows.len() as u64)
}

/// Import CSV ke tabel. Kolom diambil dari header CSV.
/// quote_style: mysql pakai backtick, postgres pakai kutip ganda.
pub async fn import_csv(
    conn: &mut Conn,
    database: &str,
    table: &str,
    path: &str,
    is_mysql: bool,
) -> Result<u64, String> {
    let q = |name: &str| if is_mysql { format!("`{name}`") } else { format!("\"{name}\"") };
    let fq = format!("{}.{}", q(database), q(table));

    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);

    let mut header = String::new();
    reader.read_line(&mut header).map_err(|e| e.to_string())?;
    let columns: Vec<String> = parse_csv_line(&header)
        .into_iter()
        .map(|c| q(&c))
        .collect();
    let cols = columns.join(", ");

    let esc = |v: &str| format!("'{}'", v.replace('\'', "''"));

    let mut count = 0u64;
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let fields = parse_csv_line(&line);
        let vals = fields
            .iter()
            .map(|f| if f.is_empty() { "NULL".to_string() } else { esc(f) })
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("INSERT INTO {fq} ({cols}) VALUES ({vals})");
        conn.query(&sql).await?;
        count += 1;
    }
    Ok(count)
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut it = line.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '"' => {
                if in_quotes && it.peek() == Some(&'"') {
                    it.next();
                    cur.push('"');
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => {
                out.push(cur.trim().to_string());
                cur = String::new();
            }
            '\r' => {}
            '\n' => break,
            _ => cur.push(c),
        }
    }
    out.push(cur.trim().to_string());
    out
}
