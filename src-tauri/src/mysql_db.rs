use super::{ColumnInfo, ConnParams, DbObjects, QueryResult, TableSchema};
use mysql_async::prelude::*;
use mysql_async::{Conn as MysqlRawConn, OptsBuilder, Row, SslOpts, Value};

pub struct MysqlConn {
    conn: MysqlRawConn,
}

fn build_opts(p: &ConnParams) -> OptsBuilder {
    let mut builder = OptsBuilder::default()
        .ip_or_hostname(p.host.clone())
        .tcp_port(p.port)
        .user(Some(p.user.clone()))
        .pass(Some(p.password.clone()))
        .db_name(p.database.clone());
    if p.ssl {
        builder = builder.ssl_opts(SslOpts::default().with_danger_accept_invalid_certs(true));
    }
    builder
}

fn value_to_json(v: Value) -> serde_json::Value {
    match v {
        Value::NULL => serde_json::Value::Null,
        Value::Int(i) => serde_json::Value::from(i),
        Value::UInt(u) => serde_json::Value::from(u),
        Value::Float(f) => serde_json::Value::from(f),
        Value::Double(d) => serde_json::Value::from(d),
        Value::Bytes(b) => serde_json::Value::String(String::from_utf8_lossy(&b).to_string()),
        Value::Date(y, mo, d, h, mi, s, us) => {
            serde_json::Value::String(format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}.{us:06}"))
        }
        Value::Time(neg, days, h, mi, s, us) => {
            let sign = if neg { "-" } else { "" };
            serde_json::Value::String(format!("{sign}{days} {h:02}:{mi:02}:{s:02}.{us:06}"))
        }
    }
}

fn rows_to_result(columns: Vec<String>, rows: Vec<Vec<serde_json::Value>>, duration_ms: u64) -> QueryResult {
    QueryResult {
        columns,
        rows,
        rows_affected: 0,
        duration_ms,
        is_select: true,
    }
}

fn row_to_json(row: Row) -> Vec<serde_json::Value> {
    row.unwrap().into_iter().map(value_to_json).collect()
}

impl MysqlConn {
    pub async fn connect(p: &ConnParams) -> Result<Self, String> {
        let conn = MysqlRawConn::new(build_opts(p))
            .await
            .map_err(|e| format!("MySQL connect failed: {e}"))?;
        Ok(Self { conn })
    }

    pub async fn server_version(&mut self) -> Result<String, String> {
        let r: Option<(String,)> = self
            .conn
            .query_first("SELECT VERSION()")
            .await
            .map_err(|e| e.to_string())?;
        Ok(r.map(|t| t.0).unwrap_or_default())
    }

    /// Deteksi statement pertama (abaikan komentar -- dan /* */) apakah mengembalikan result set.
    fn first_keyword_is_select(sql: &str) -> bool {
        let mut rest = sql.trim_start();
        loop {
            if rest.starts_with("--") {
                match rest.find('\n') {
                    Some(i) => rest = rest[i + 1..].trim_start(),
                    None => return false, // hanya komentar
                }
            } else if rest.starts_with('#') {
                match rest.find('\n') {
                    Some(i) => rest = rest[i + 1..].trim_start(),
                    None => return false,
                }
            } else if rest.starts_with("/*") {
                match rest.find("*/") {
                    Some(i) => rest = rest[i + 2..].trim_start(),
                    None => return false,
                }
            } else if rest.starts_with('(') {
                // sub-select dalam kurung: SELECT ...
                return rest[1..].trim_start().to_uppercase().starts_with("SELECT");
            } else {
                break;
            }
        }
        let kw = rest
            .split(|c: char| c.is_whitespace() || c == '(')
            .next()
            .unwrap_or("");
        ["SELECT", "SHOW", "DESC", "DESCRIBE", "WITH", "EXPLAIN", "VALUES", "TABLE"]
            .iter()
            .any(|k| kw.eq_ignore_ascii_case(k))
    }

    pub async fn query(&mut self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let is_select = Self::first_keyword_is_select(sql);

        if is_select {
            let mut result = self
                .conn
                .query_iter(sql)
                .await
                .map_err(|e| format!("SQL error: {e}"))?;
            let columns: Vec<String> = result
                .columns()
                .map(|cols| cols.iter().map(|c| c.name_str().to_string()).collect())
                .unwrap_or_default();
            let mut rows = Vec::new();
            while let Some(row) = result.next().await.map_err(|e| e.to_string())? {
                rows.push(row_to_json(row));
            }
            Ok(rows_to_result(
                columns,
                rows,
                start.elapsed().as_millis() as u64,
            ))
        } else {
            self.conn
                .query_drop(sql)
                .await
                .map_err(|e| format!("SQL error: {e}"))?;
            Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: self.conn.affected_rows(),
                duration_ms: start.elapsed().as_millis() as u64,
                is_select: false,
            })
        }
    }

    pub async fn list_databases(&mut self) -> Result<Vec<String>, String> {
        let result: Vec<(String,)> = self
            .conn
            .query("SHOW DATABASES")
            .await
            .map_err(|e| e.to_string())?;
        Ok(result.into_iter().map(|t| t.0).collect())
    }

    pub async fn list_objects(&mut self, database: &str) -> Result<DbObjects, String> {
        let tables_sql = format!(
            "SELECT table_name FROM information_schema.tables \
             WHERE table_schema='{database}' AND table_type='BASE TABLE' ORDER BY table_name"
        );
        let views_sql = format!(
            "SELECT table_name FROM information_schema.tables \
             WHERE table_schema='{database}' AND table_type='VIEW' ORDER BY table_name"
        );
        let procs_sql = format!(
            "SELECT routine_name FROM information_schema.routines \
             WHERE routine_schema='{database}' AND routine_type='PROCEDURE' ORDER BY routine_name"
        );
        let funcs_sql = format!(
            "SELECT routine_name FROM information_schema.routines \
             WHERE routine_schema='{database}' AND routine_type='FUNCTION' ORDER BY routine_name"
        );
        let trig_sql = format!(
            "SELECT trigger_name FROM information_schema.triggers \
             WHERE trigger_schema='{database}' ORDER BY trigger_name"
        );
        let events_sql = format!(
            "SELECT event_name FROM information_schema.events \
             WHERE event_schema='{database}' ORDER BY event_name"
        );

        let tables = self.names(&tables_sql).await?;
        let views = self.names(&views_sql).await?;
        let procedures = self.names(&procs_sql).await?;
        let functions = self.names(&funcs_sql).await?;
        let triggers = self.names(&trig_sql).await?;
        let events = self.names(&events_sql).await?;

        Ok(DbObjects {
            tables,
            views,
            procedures,
            functions,
            triggers,
            events,
        })
    }

    pub async fn table_schemas(&mut self, database: &str) -> Result<Vec<TableSchema>, String> {
        use super::ForeignKeyInfo;
        let cols: Vec<(String, String, String, String, Option<String>, String, Option<String>)> = self
            .conn
            .query(format!(
                "SELECT table_name, column_name, data_type, is_nullable, column_key, column_type, column_comment \
                 FROM information_schema.columns WHERE table_schema='{database}' \
                 ORDER BY table_name, ordinal_position"
            ))
            .await
            .map_err(|e| e.to_string())?;

        let fks: Vec<(String, String, String, String)> = self
            .conn
            .query(format!(
                "SELECT table_name, column_name, referenced_table_name, referenced_column_name \
                 FROM information_schema.key_column_usage \
                 WHERE table_schema='{database}' AND referenced_table_name IS NOT NULL"
            ))
            .await
            .map_err(|e| e.to_string())?;

        // komentar tabel
        let tcomments: Vec<(String, Option<String>)> = self
            .conn
            .query(format!(
                "SELECT table_name, table_comment FROM information_schema.tables \
                 WHERE table_schema='{database}' AND table_type='BASE TABLE'"
            ))
            .await
            .map_err(|e| e.to_string())?;

        let mut schemas: Vec<TableSchema> = Vec::new();
        for (t, name, data_type, nullable, key, col_type, comment) in cols {
            let ci = ColumnInfo {
                name,
                data_type: col_type, // full type dgn panjang: varchar(255)
                nullable: nullable == "YES",
                key: key.unwrap_or_default(),
                default: None,
                comment,
            };
            match schemas.last_mut() {
                Some(s) if s.table == t => s.columns.push(ci),
                _ => schemas.push(TableSchema {
                    table: t,
                    table_comment: None,
                    columns: vec![ci],
                    foreign_keys: vec![],
                }),
            }
        }
        for (t, comment) in tcomments {
            if let Some(s) = schemas.iter_mut().find(|s| s.table == t) {
                s.table_comment = Some(comment.unwrap_or_default());
            }
        }
        for (t, col, rt, rc) in fks {
            if let Some(s) = schemas.iter_mut().find(|s| s.table == t) {
                s.foreign_keys.push(ForeignKeyInfo {
                    column: col,
                    ref_table: rt,
                    ref_column: rc,
                });
            }
        }
        Ok(schemas)
    }

    async fn names(&mut self, sql: &str) -> Result<Vec<String>, String> {
        let r: Vec<(String,)> = self.conn.query(sql).await.map_err(|e| e.to_string())?;
        Ok(r.into_iter().map(|t| t.0).collect())
    }

    pub async fn table_columns(&mut self, database: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
        let r: Vec<(String, String, String, Option<String>, Option<String>, Option<String>)> = self
            .conn
            .query(format!(
                "SELECT column_name, column_type, is_nullable, column_key, column_default, column_comment \
                 FROM information_schema.columns \
                 WHERE table_schema='{database}' AND table_name='{table}' ORDER BY ordinal_position"
            ))
            .await
            .map_err(|e| e.to_string())?;
        Ok(r.into_iter()
            .map(|(name, data_type, nullable, key, default, comment)| ColumnInfo {
                name,
                data_type,
                nullable: nullable == "YES",
                key: key.unwrap_or_default(),
                default,
                comment,
            })
            .collect())
    }

    pub async fn select_rows(
        &mut self,
        database: &str,
        table: &str,
        limit: u32,
        offset: u32,
    ) -> Result<QueryResult, String> {
        let sql = format!("SELECT * FROM `{database}`.`{table}` LIMIT {limit} OFFSET {offset}");
        self.query(&sql).await
    }
}
