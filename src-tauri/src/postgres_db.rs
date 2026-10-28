use super::{ColumnInfo, ConnParams, DbObjects, ForeignKeyInfo, QueryResult, TableSchema};
use postgres_native_tls::MakeTlsConnector;
use tokio_postgres::{Client, NoTls};

pub struct PgConn {
    client: Client,
}

impl PgConn {
    pub async fn connect(p: &ConnParams) -> Result<Self, String> {
        let dbname = p.database.clone().unwrap_or_else(|| "postgres".into());
        let conn_str = format!(
            "host={} port={} user={} password={} dbname={} sslmode={}",
            p.host,
            p.port,
            p.user,
            p.password,
            dbname,
            if p.ssl { "require" } else { "disable" }
        );
        let client = if p.ssl {
            let connector = native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .build()
                .map_err(|e| e.to_string())?;
            let (client, connection) =
                tokio_postgres::connect(&conn_str, MakeTlsConnector::new(connector))
                    .await
                    .map_err(|e| format!("PostgreSQL connect failed: {e}"))?;
            tokio::spawn(async move {
                let _ = connection.await;
            });
            client
        } else {
            let (client, connection) = tokio_postgres::connect(&conn_str, NoTls)
                .await
                .map_err(|e| format!("PostgreSQL connect failed: {e}"))?;
            tokio::spawn(async move {
                let _ = connection.await;
            });
            client
        };
        Ok(Self { client })
    }

    pub async fn server_version(&mut self) -> Result<String, String> {
        let row = self
            .client
            .query_one("SELECT version()", &[])
            .await
            .map_err(|e| e.to_string())?;
        let v: String = row.get(0);
        Ok(v)
    }

    pub async fn query(&mut self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let rows = self
            .client
            .simple_query(sql)
            .await
            .map_err(|e| format!("SQL error: {e}"))?;

        let mut columns: Vec<String> = Vec::new();
        let mut out_rows: Vec<Vec<serde_json::Value>> = Vec::new();
        let mut rows_affected: u64 = 0;

        for msg in rows {
            match msg {
                tokio_postgres::SimpleQueryMessage::Row(row) => {
                    if columns.is_empty() {
                        columns = (0..row.len())
                            .map(|i| row.columns()[i].name().to_string())
                            .collect();
                    }
                    let mut vals = Vec::with_capacity(row.len());
                    for i in 0..row.len() {
                        vals.push(match row.get(i) {
                            None => serde_json::Value::Null,
                            Some(s) => serde_json::Value::String(s.to_string()),
                        });
                    }
                    out_rows.push(vals);
                }
                tokio_postgres::SimpleQueryMessage::CommandComplete(c) => {
                    rows_affected = c;
                }
                _ => {}
            }
        }
        let is_select = !columns.is_empty();
        Ok(QueryResult {
            columns,
            rows: out_rows,
            rows_affected,
            duration_ms: start.elapsed().as_millis() as u64,
            is_select,
        })
    }

    pub async fn list_databases(&mut self) -> Result<Vec<String>, String> {
        let rows = self
            .client
            .query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname", &[])
            .await
            .map_err(|e| e.to_string())?;
        Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
    }

    pub async fn list_objects(&mut self, _database: &str) -> Result<DbObjects, String> {
        let tables = self
            .client
            .query(
                "SELECT table_name FROM information_schema.tables \
                 WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;
        let views = self
            .client
            .query(
                "SELECT table_name FROM information_schema.views \
                 WHERE table_schema='public' ORDER BY table_name",
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;
        let routines_proc = self.routine_names("PROCEDURE").await?;
        let routines_func = self.routine_names("FUNCTION").await?;
        let triggers = self
            .client
            .query(
                "SELECT DISTINCT trigger_name FROM information_schema.triggers \
                 WHERE trigger_schema='public' ORDER BY trigger_name",
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(DbObjects {
            tables: tables.iter().map(|r| r.get::<_, String>(0)).collect(),
            views: views.iter().map(|r| r.get::<_, String>(0)).collect(),
            procedures: routines_proc,
            functions: routines_func,
            triggers: triggers.iter().map(|r| r.get::<_, String>(0)).collect(),
            events: vec![],
        })
    }

    async fn routine_names(&self, kind: &str) -> Result<Vec<String>, String> {
        let rows = self
            .client
            .query(
                "SELECT routine_name FROM information_schema.routines \
                 WHERE routine_schema='public' AND routine_type=$1 ORDER BY routine_name",
                &[&kind],
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
    }

    pub async fn table_columns(&mut self, _database: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
        let rows = self
            .client
            .query(
                "SELECT c.column_name, c.data_type, c.is_nullable, \
                        COALESCE(tc.constraint_type,'') AS key_type, c.column_default, \
                        col_description(pgc.oid, c.ordinal_position) \
                 FROM information_schema.columns c \
                 LEFT JOIN information_schema.key_column_usage k \
                        ON k.table_schema=c.table_schema AND k.table_name=c.table_name \
                       AND k.column_name=c.column_name \
                 LEFT JOIN information_schema.table_constraints tc \
                        ON tc.constraint_name=k.constraint_name \
                       AND tc.constraint_type='PRIMARY KEY' \
                 LEFT JOIN pg_class pgc ON pgc.relname=c.table_name \
                 WHERE c.table_schema='public' AND c.table_name=$1 \
                 ORDER BY c.ordinal_position",
                &[&table],
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(rows
            .iter()
            .map(|r| {
                let name: String = r.get(0);
                let data_type: String = r.get(1);
                let nullable: String = r.get(2);
                let key: Option<String> = r.get(3);
                let default: Option<String> = r.get(4);
                let comment: Option<String> = r.get(5);
                ColumnInfo {
                    name,
                    data_type,
                    nullable: nullable == "YES",
                    key: key.unwrap_or_default(),
                    default,
                    comment,
                }
            })
            .collect())
    }

    pub async fn table_schemas(&mut self, _database: &str) -> Result<Vec<TableSchema>, String> {
        let cols = self
            .client
            .query(
                "SELECT c.table_name, c.column_name, \
                        c.data_type || COALESCE(NULLIF(concat('(', c.character_maximum_length::text, ')'), '()'), '') AS full_type, \
                        c.is_nullable, COALESCE(tc.constraint_type,''), col_description(pgc.oid, c.ordinal_position) \
                 FROM information_schema.columns c \
                 LEFT JOIN information_schema.key_column_usage k \
                        ON k.table_schema=c.table_schema AND k.table_name=c.table_name \
                       AND k.column_name=c.column_name \
                 LEFT JOIN information_schema.table_constraints tc \
                        ON tc.constraint_name=k.constraint_name AND tc.constraint_type='PRIMARY KEY' \
                 LEFT JOIN pg_class pgc ON pgc.relname=c.table_name \
                 WHERE c.table_schema='public' \
                 ORDER BY c.table_name, c.ordinal_position",
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;

        let fks = self
            .client
            .query(
                "SELECT tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name \
                 FROM information_schema.table_constraints tc \
                 JOIN information_schema.key_column_usage kcu \
                        ON kcu.constraint_name=tc.constraint_name \
                 JOIN information_schema.constraint_column_usage ccu \
                        ON ccu.constraint_name=tc.constraint_name \
                 WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'",
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;

        let tcomments = self
            .client
            .query(
                "SELECT c.relname, obj_description(c.oid) FROM pg_class c \
                 JOIN pg_namespace n ON n.oid=c.relnamespace \
                 WHERE n.nspname='public' AND c.relkind='r'",
                &[],
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut schemas: Vec<TableSchema> = Vec::new();
        for r in &cols {
            let t: String = r.get(0);
            let name: String = r.get(1);
            let data_type: String = r.get(2);
            let nullable: String = r.get(3);
            let key: Option<String> = r.get(4);
            let comment: Option<String> = r.get(5);
            let ci = ColumnInfo {
                name,
                data_type,
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
        for r in &tcomments {
            let t: String = r.get(0);
            let comment: Option<String> = r.get(1);
            if let Some(s) = schemas.iter_mut().find(|s| s.table == t) {
                s.table_comment = comment;
            }
        }
        for r in &fks {
            let t: String = r.get(0);
            let col: String = r.get(1);
            let rt: String = r.get(2);
            let rc: String = r.get(3);
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

    pub async fn select_rows(
        &mut self,
        _database: &str,
        table: &str,
        limit: u32,
        offset: u32,
    ) -> Result<QueryResult, String> {
        let sql = format!("SELECT * FROM public.\"{table}\" LIMIT {limit} OFFSET {offset}");
        self.query(&sql).await
    }
}
