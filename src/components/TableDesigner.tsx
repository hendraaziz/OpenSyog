import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, TableSchema } from "../store";

interface ColDef {
  name: string;
  type: string;
  length: string;
  nullable: boolean;
  ai: boolean; // auto increment
  pk: boolean;
  def: string;
  defUse: boolean;
  comment: string;
  origType: string; // full type existing dari schema (untuk deteksi perubahan)
}

const TYPES = [
  "INT", "BIGINT", "SMALLINT", "TINYINT", "MEDIUMINT", "DECIMAL", "FLOAT", "DOUBLE",
  "VARCHAR", "CHAR", "TINYTEXT", "TEXT", "MEDIUMTEXT", "LONGTEXT",
  "DATE", "DATETIME", "TIMESTAMP", "TIME", "YEAR",
  "BOOLEAN", "JSON", "BLOB", "LONGBLOB", "ENUM", "SET", "BIT",
  "SERIAL", "NUMERIC", "REAL", "BYTEA", "UUID", "INET",
];

/** Parse full type dari information_schema (mis. "varchar(255)", "int unsigned") → { type, length }. */
function parseFullType(full: string): { type: string; length: string } {
  const m = full.trim().match(/^([A-Za-z_]+)(?:\s*\(([^)]+)\))?/);
  let type = (m?.[1] ?? full.trim()).toUpperCase();
  let length = m?.[2] ?? "";
  const extra = full.trim().slice(m?.[0].length ?? 0).trim().toUpperCase();
  if (extra) type = `${type} ${extra}`;
  return { type, length };
}

/** Tab "Manage Table" — visual CREATE TABLE & ALTER TABLE (add/modify/drop kolom, PK, comment). */
export default function TableDesigner({
  connId,
  database,
  editTable,
  onClose,
}: {
  connId: string;
  database: string;
  editTable?: string | null;
  onClose: () => void;
}) {
  const conn = useStore((s) => s.connections.find((c) => c.id === connId));
  const isMysql = conn?.dbType === "mysql";
  const q = (n: string) => (isMysql ? `\`${n}\`` : `"${n}"`);

  const [name, setName] = useState(editTable ?? "new_table");
  const [cols, setCols] = useState<ColDef[]>([
    { name: "id", type: "INT", length: "", nullable: false, ai: isMysql ?? true, pk: true, def: "", defUse: false, comment: "", origType: "" },
    { name: "nama", type: "VARCHAR", length: "255", nullable: false, ai: false, pk: false, def: "", defUse: false, comment: "", origType: "" },
  ]);
  const [tableComment, setTableComment] = useState("");
  const [engine, setEngine] = useState("InnoDB");
  const [charset, setCharset] = useState("utf8mb4");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [origTableComment, setOrigTableComment] = useState<string | null>(null);

  // mode alter: muat struktur existing dari schema cache
  useEffect(() => {
    if (!editTable) return;
    const schema: TableSchema[] | null | undefined = conn?.schema;
    const ts = schema?.find((s) => s.table.toLowerCase() === editTable.toLowerCase());
    if (ts) {
      setName(ts.table);
      setOrigTableComment(ts.table_comment ?? "");
      setTableComment(ts.table_comment ?? "");
      setCols(
        ts.columns.map((c) => {
          const { type, length } = parseFullType(c.data_type);
          return {
            name: c.name,
            type,
            length,
            nullable: c.nullable,
            ai: c.key === "AI" || /auto_increment/i.test(c.data_type) || c.default === "autoincrement" || /\bnextval\b/i.test(c.default ?? ""),
            pk: c.key === "PRI" || c.key === "PRIMARY KEY",
            def: c.default ?? "",
            defUse: c.default !== null && c.default !== undefined,
            comment: c.comment ?? "",
            origType: c.data_type,
          };
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCol = (i: number, patch: Partial<ColDef>) =>
    setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const addCol = () =>
    setCols((cs) => [
      ...cs,
      { name: `kolom_${cs.length + 1}`, type: "VARCHAR", length: "255", nullable: true, ai: false, pk: false, def: "", defUse: false, comment: "", origType: "" },
    ]);

  const delCol = (i: number) => setCols((cs) => cs.filter((_, j) => j !== i));
  const moveCol = (i: number, dir: -1 | 1) =>
    setCols((cs) => {
      const j = i + dir;
      if (j < 0 || j >= cs.length) return cs;
      const n = [...cs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const buildType = (c: ColDef) =>
    c.length ? `${c.type}(${c.length})` : c.type;

  const litDef = (c: ColDef) =>
    c.def === "CURRENT_TIMESTAMP" || c.def === "NOW()" || /^\d+(\.\d+)?$/.test(c.def)
      ? c.def
      : `'${c.def.replace(/'/g, "''")}'`;

  const buildCreateSql = () => {
    const lines = cols.map((c) => {
      let l = `  ${q(c.name)} ${buildType(c)}`;
      if (c.ai && isMysql) l += " AUTO_INCREMENT";
      if (!c.nullable) l += " NOT NULL";
      if (c.defUse) l += ` DEFAULT ${litDef(c)}`;
      if (c.comment && isMysql) l += ` COMMENT '${c.comment.replace(/'/g, "''")}'`;
      return l;
    });
    const pk = cols.filter((c) => c.pk).map((c) => q(c.name));
    if (pk.length) lines.push(`  PRIMARY KEY (${pk.join(", ")})`);
    let opts = isMysql ? ` ENGINE=${engine} DEFAULT CHARSET=${charset}` : "";
    if (isMysql && tableComment) opts += ` COMMENT='${tableComment.replace(/'/g, "''")}'`;
    return `CREATE TABLE ${q(database)}.${q(name)} (\n${lines.join(",\n")}\n)${opts};`;
  };

  /** Kumpulan statement alter (PostgreSQL comment butuh statement terpisah). */
  const buildAlterSqls = (): string[] => {
    const orig = editTable!;
    const schema: TableSchema[] | null | undefined = conn?.schema;
    const ts = schema?.find((s) => s.table.toLowerCase() === orig.toLowerCase());
    const parts: string[] = [];
    const pgComments: string[] = [];

    // bandingkan kolom lama vs baru berdasarkan nama
    const oldNames = new Set(ts?.columns.map((c) => c.name.toLowerCase()) ?? []);
    const newNames = new Set(cols.map((c) => c.name.toLowerCase()));

    for (const c of cols) {
      const typeSql = buildType(c);
      const nullSql = c.nullable ? "NULL" : "NOT NULL";
      const defSql = c.defUse ? ` DEFAULT ${litDef(c)}` : "";
      const old = ts?.columns.find((o) => o.name.toLowerCase() === c.name.toLowerCase());
      if (!old && oldNames.size > 0) {
        // kolom baru
        parts.push(
          isMysql
            ? `ADD COLUMN ${q(c.name)} ${typeSql} ${nullSql}${defSql}${c.ai ? " AUTO_INCREMENT" : ""}${c.comment ? ` COMMENT '${c.comment.replace(/'/g, "''")}'` : ""}`
            : `ADD COLUMN ${q(c.name)} ${typeSql} ${nullSql}${defSql}`
        );
        if (!isMysql && c.comment)
          pgComments.push(`COMMENT ON COLUMN ${q(database)}.${q(orig)}.${q(c.name)} IS '${c.comment.replace(/'/g, "''")}'`);
      } else if (old) {
        // kolom berubah? bandingkan tipe/nullability/default/comment
        const oldNorm = parseFullType(old.data_type);
        const oldDef = old.default ?? null;
        const changed =
          oldNorm.type !== c.type || oldNorm.length !== c.length ||
          old.nullable !== c.nullable ||
          oldDef !== (c.defUse ? c.def : null) ||
          (old.comment ?? "") !== c.comment;
        if (changed) {
          parts.push(
            isMysql
              ? `MODIFY COLUMN ${q(c.name)} ${typeSql} ${nullSql}${defSql}${c.comment ? ` COMMENT '${c.comment.replace(/'/g, "''")}'` : ""}`
              : `ALTER COLUMN ${q(c.name)} TYPE ${typeSql}${c.nullable ? "" : ", ALTER COLUMN " + q(c.name) + " SET NOT NULL"}`
          );
          if (!isMysql) {
            pgComments.push(`COMMENT ON COLUMN ${q(database)}.${q(orig)}.${q(c.name)} IS '${c.comment.replace(/'/g, "''")}'`);
            if (oldDef !== (c.defUse ? c.def : null) && c.defUse)
              parts.push(`ALTER COLUMN ${q(c.name)} SET DEFAULT ${litDef(c)}`);
          }
        }
      }
    }
    for (const o of ts?.columns ?? []) {
      if (!newNames.has(o.name.toLowerCase())) {
        parts.push(`DROP COLUMN ${q(o.name)}`);
      }
    }
    // PK change (MySQL only, simple case)
    const newPk = cols.filter((c) => c.pk).map((c) => c.name);
    const oldPk = ts?.columns.filter((c) => c.key === "PRI").map((c) => c.name) ?? [];
    if (isMysql && newPk.join(",") !== oldPk.join(",")) {
      if (oldPk.length) parts.push(`DROP PRIMARY KEY`);
      if (newPk.length) parts.push(`ADD PRIMARY KEY (${newPk.map(q).join(", ")})`);
    }
    // table comment
    if (isMysql && tableComment !== (origTableComment ?? "")) {
      parts.push(`COMMENT='${tableComment.replace(/'/g, "''")}'`);
    }
    if (!isMysql && tableComment !== (origTableComment ?? "")) {
      pgComments.push(`COMMENT ON TABLE ${q(database)}.${q(orig)} IS '${tableComment.replace(/'/g, "''")}'`);
    }

    const stmts: string[] = [];
    if (parts.length > 0)
      stmts.push(`ALTER TABLE ${q(database)}.${q(orig)}\n  ${parts.join(",\n  ")};`);
    stmts.push(...pgComments.map((s) => s + ";"));
    return stmts;
  };

  const apply = async () => {
    setBusy(true);
    setErr(null);
    setOk(null);
    const stmts = editTable ? buildAlterSqls() : [buildCreateSql()];
    if (stmts.length === 0) {
      setErr("Tidak ada perubahan yang perlu diterapkan.");
      setBusy(false);
      return;
    }
    try {
      for (const sql of stmts) await invoke("execute", { id: connId, sql });
      setOk(`✔ ${editTable ? "Alter" : "Create"} berhasil`);
      await useStore.getState().refreshConn(connId);
      await useStore.getState().selectDatabase(connId, database);
      setTimeout(onClose, 800);
    } catch (e: any) {
      setErr(`Error: ${e}`);
      setOk(`SQL:\n${stmts.join("\n")}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="table-designer">
      <div className="td-toolbar">
        <h2>{editTable ? `Alter Table — ${name}` : "Create Table"}</h2>
        <span className="muted">{conn?.name} / {database}</span>
        <span className="spacer" />
        <button onClick={onClose}>Tutup</button>
        <button className="primary" disabled={busy} onClick={apply}>
          {busy ? "Menjalankan…" : editTable ? "Apply Alter" : "Create Table"}
        </button>
      </div>

      <div className="row td-meta">
        <label className="grow">
          Nama tabel
          <input
            value={name}
            disabled={Boolean(editTable)}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="grow2">
          Comment tabel
          <input
            value={tableComment}
            placeholder="Catatan untuk tabel ini…"
            onChange={(e) => setTableComment(e.target.value)}
          />
        </label>
        {isMysql && (
          <>
            <label>
              Engine
              <select value={engine} onChange={(e) => setEngine(e.target.value)} disabled={Boolean(editTable)}>
                {["InnoDB", "MyISAM", "MEMORY", "Aria"].map((e2) => <option key={e2}>{e2}</option>)}
              </select>
            </label>
            <label>
              Charset
              <select value={charset} onChange={(e) => setCharset(e.target.value)} disabled={Boolean(editTable)}>
                {["utf8mb4", "utf8", "latin1"].map((c2) => <option key={c2}>{c2}</option>)}
              </select>
            </label>
          </>
        )}
      </div>

      <div className="td-cols">
        <table>
          <thead>
            <tr>
              <th></th><th>Nama</th><th>Tipe</th><th>Panjang/Nilai</th>
              <th>Null</th><th>PK</th>{isMysql && <th>AI</th>}<th>Default</th><th>Comment</th><th></th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c, i) => (
              <tr key={i}>
                <td className="td-ops">
                  <button title="Naik" onClick={() => moveCol(i, -1)}>↑</button>
                  <button title="Turun" onClick={() => moveCol(i, 1)}>↓</button>
                </td>
                <td><input value={c.name} onChange={(e) => setCol(i, { name: e.target.value })} /></td>
                <td>
                  <select value={c.type} onChange={(e) => setCol(i, { type: e.target.value, origType: "" })}>
                    {!TYPES.includes(c.type) && <option value={c.type}>{c.type}</option>}
                    {TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </td>
                <td><input className="w110" value={c.length} onChange={(e) => setCol(i, { length: e.target.value })} /></td>
                <td className="td-check"><input type="checkbox" checked={c.nullable} onChange={(e) => setCol(i, { nullable: e.target.checked })} /></td>
                <td className="td-check"><input type="checkbox" checked={c.pk} onChange={(e) => setCol(i, { pk: e.target.checked })} /></td>
                {isMysql && (
                  <td className="td-check">
                    <input type="checkbox" checked={c.ai} disabled={!isMysql} onChange={(e) => setCol(i, { ai: e.target.checked })} />
                  </td>
                )}
                <td>
                  <div className="row nowrap">
                    <input
                      className="w110"
                      value={c.def}
                      disabled={!c.defUse}
                      placeholder={c.defUse ? "nilai / CURRENT_TIMESTAMP" : ""}
                      onChange={(e) => setCol(i, { def: e.target.value })}
                    />
                    <input
                      type="checkbox"
                      title="Pakai default"
                      checked={c.defUse}
                      onChange={(e) => setCol(i, { defUse: e.target.checked })}
                    />
                  </div>
                </td>
                <td>
                  <input
                    value={c.comment}
                    placeholder="Catatan kolom…"
                    onChange={(e) => setCol(i, { comment: e.target.value })}
                  />
                </td>
                <td className="td-ops">
                  <button className="danger" title="Hapus kolom" onClick={() => delCol(i)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="td-add" onClick={addCol}>+ Tambah Kolom</button>
      </div>

      {err && <div className="error">{err}</div>}
      {ok && <pre className="ok-box">{ok}</pre>}
    </div>
  );
}
