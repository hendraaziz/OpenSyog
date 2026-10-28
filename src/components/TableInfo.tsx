import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, QueryResult, TableDataView } from "../store";

/** Tab Info: informasi tabel aktif (engine, rows, ukuran, kolom, relasi). */
export default function TableInfo({ tableData }: { tableData: TableDataView }) {
  const conn = useStore((s) => s.connections.find((c) => c.id === tableData.connId));
  const schema = conn?.schema ?? null;
  const tableSchema = schema?.find(
    (s) => s.table.toLowerCase() === tableData.table.toLowerCase()
  );
  const [status, setStatus] = useState<QueryResult | null>(null);

  const q = (n: string) => (conn?.dbType === "mysql" ? `\`${n}\`` : `"${n}"`);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let sql: string;
        if (conn?.dbType === "mysql") {
          sql = `SHOW TABLE STATUS FROM ${q(tableData.database)} LIKE '${tableData.table.replace(/'/g, "''")}'`;
        } else {
          sql = `SELECT c.relname AS "Name", c.reltuples::bigint AS "Rows (est)", pg_size_pretty(pg_total_relation_size(c.oid)) AS "Total Size", obj_description(c.oid) AS "Comment" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='${tableData.table.replace(/'/g, "''")}'`;
        }
        const r = await invoke<QueryResult>("execute", { id: tableData.connId, sql });
        if (alive) setStatus(r);
      } catch {
        if (alive) setStatus(null);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableData.connId, tableData.database, tableData.table]);

  const info = status?.rows[0] ?? null;
  const infoCols = status?.columns ?? [];

  return (
    <div className="table-info">
      <div className="grid-scroll">
        <h3>Table Information</h3>
        {info && infoCols.length > 0 ? (
          <table className="info-props">
            <tbody>
              {infoCols.map((c, i) => (
                <tr key={c}>
                  <td className="prop-name">{c}</td>
                  <td>{info[i] === null || info[i] === undefined ? "—" : String(info[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="muted">Informasi server tidak tersedia.</div>
        )}

        <h3>Columns ({tableSchema?.columns.length ?? "—"})</h3>
        <table className="info-cols">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Null</th>
              <th>Key</th>
              <th>Default</th>
              <th>Comment</th>
              <th>Relasi</th>
            </tr>
          </thead>
          <tbody>
            {(tableSchema?.columns ?? []).map((c) => {
              const fk = tableSchema?.foreign_keys.find(
                (f) => f.column.toLowerCase() === c.name.toLowerCase()
              );
              return (
                <tr key={c.name}>
                  <td className={fk ? "fk-col" : ""}>{c.name}</td>
                  <td>{c.data_type}</td>
                  <td>{c.nullable ? "YES" : "NO"}</td>
                  <td>{c.key || ""}</td>
                  <td>{c.default ?? "—"}</td>
                  <td className="info-comment">{c.comment || "—"}</td>
                  <td>{fk ? `🔗 ${fk.ref_table}.${fk.ref_column}` : ""}</td>
                </tr>
              );
            })}
            {!tableSchema && (
              <tr>
                <td colSpan={7} className="muted">Pilih database untuk memuat skema.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
