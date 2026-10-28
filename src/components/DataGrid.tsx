import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useStore, QueryResult, TableSchema } from "../store";

interface EditState {
  rowIdx: number;
  colIdx: number;
  value: string;
  isNull: boolean;
}

type Props = {
  // mode table data (editable) vs query result (readonly)
  tableName?: string | null;
  database?: string | null;
  connId?: string | null;
  limit?: number;
  offset?: number;
  paging?: boolean;
  result?: QueryResult | null;
  onRefresh?: () => void;
  onOffsetChange?: (offset: number) => void;
  onLimitChange?: (limit: number) => void;
  showAll?: boolean;
  onShowAllChange?: (v: boolean) => void;
};

type CopyFormat = "tsv" | "csv" | "json" | "sql" | "html";

export default function DataGrid(props: Props) {
  const tab = useStore((s) => s.queryTabs.find((t) => t.id === s.activeQueryTabId));
  const conn = useStore((s) => s.connections.find((c) => c.id === s.activeConnId));
  const activeConnId = useStore((s) => s.activeConnId);

  // editable bila dipanggil utk tabel terpilih di koneksi aktif
  const editable =
    props.tableName === undefined ? false : Boolean(props.tableName && props.database && props.connId);

  const result: QueryResult | null = props.result ?? tab?.result ?? null;

  const [edit, setEdit] = useState<EditState | null>(null);
  const [savedRows, setSavedRows] = useState<QueryResult | null>(null);
  const [pkColumns, setPkColumns] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showExport, setShowExport] = useState(false);
  const [copyModal, setCopyModal] = useState(false);
  const [copyModalMode, setCopyModalMode] = useState<"copy" | "export">("copy");
  const [relModal, setRelModal] = useState<{ refTable: string; refColumn: string; column: string } | null>(null);
  // sorting: kolom → "asc" | "desc" | null (klik ketiga = hapus)
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  // filter: daftar kondisi multi kolom
  interface FilterCond { col: string; op: string; value: string }
  const [filters, setFilters] = useState<FilterCond[]>([]);
  const [showFilter, setShowFilter] = useState(false);

  // ===== virtualisasi render: hanya render baris yang terlihat (fix freeze saat "Semua") =====
  const gridRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const ROW_H = 24;
  useEffect(() => {
    const el = gridRef.current;
    if (el) {
      setViewH(el.clientHeight || 600);
      el.scrollTop = 0;
      setScrollTop(0);
    }
  }, [props.result, tab?.result, props.tableName, props.offset, props.limit]);

  // schema utk ikon relasi
  const schema: TableSchema[] | null = props.connId
    ? useStore.getState().connections.find((c) => c.id === props.connId)?.schema ?? null
    : null;
  const tableSchema = props.tableName
    ? schema?.find((s) => s.table.toLowerCase() === String(props.tableName).toLowerCase())
    : null;

  // reset state saat data berganti
  useEffect(() => {
    setSavedRows(props.result ?? tab?.result ?? null);
    setSelected(new Set());
    setEdit(null);
    setSort(null);
    setFilters([]);
  }, [props.result, tab?.result, props.tableName, props.offset, props.limit]);

  // deteksi kolom PK utk UPDATE/DELETE
  useEffect(() => {
    if (!editable || !props.connId || !props.database || !props.tableName) {
      setPkColumns([]);
      return;
    }
    const schema = useStore.getState().connections.find((c) => c.id === props.connId)?.schema;
    const fromSchema = schema?.find(
      (s) => s.table.toLowerCase() === props.tableName!.toLowerCase()
    );
    if (fromSchema) {
      const pks = fromSchema.columns.filter((c) => c.key === "PRI" || c.key === "PRIMARY KEY").map((c) => c.name);
      setPkColumns(pks.length ? pks : fromSchema.columns.slice(0, 1).map((c) => c.name));
      return;
    }
    invoke<any[]>("table_columns", {
      id: props.connId,
      database: props.database,
      table: props.tableName,
    })
      .then((cols) => {
        const pks = cols.filter((c) => c.key === "PRI" || c.key === "PRIMARY KEY").map((c) => c.name);
        setPkColumns(pks.length ? pks : cols.slice(0, 1).map((c) => c.name));
      })
      .catch(() => setPkColumns([]));
  }, [editable, props.tableName, props.database, props.connId]);

  const quote = (name: string) =>
    conn?.dbType === "mysql" ? `\`${name}\`` : `"${name}"`;

  const sqlValue = (v: any) => {
    if (v === null) return "NULL";
    if (typeof v === "number") return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  };

  const whereForRow = (row: any[]) => {
    if (!result) return "";
    const whereCols = pkColumns.length ? pkColumns : result.columns;
    return whereCols
      .map((c) => {
        const ci = result.columns.indexOf(c);
        return `${quote(c)} = ${sqlValue(row[ci])}`;
      })
      .join(" AND ");
  };

  // nilai tersimpan utk deteksi "ada data diubah"
  const saved = (i: number, j: number) => {
    if (savedRows && savedRows.rows[i]) return savedRows.rows[i][j];
    return result?.rows[i]?.[j] ?? null;
  };
  const dirty = edit !== null &&
    result &&
    (edit.isNull !== (saved(edit.rowIdx, edit.colIdx) === null) ||
      (!edit.isNull && edit.value !== String(saved(edit.rowIdx, edit.colIdx) ?? "")));

  const commitEdit = async (dir?: "up" | "down") => {
    if (!edit || !result) return;
    const { rowIdx, colIdx, value, isNull } = edit;
    const newVal = isNull ? null : value;

    const where = whereForRow(result.rows[rowIdx]);
    const sql = `UPDATE ${quote(String(props.database))}.${quote(String(props.tableName))} SET ${quote(result.columns[colIdx])} = ${sqlValue(newVal)} WHERE ${where}`;
    try {
      await invoke("execute", { id: props.connId, sql });
      useStore.setState({ statusMessage: "1 row updated" });
      // update cache lokal agar autosave antar baris tidak menimpa nilai lama
      const newRows = result.rows.map((r, i) =>
        i === rowIdx ? r.map((v, j) => (j === colIdx ? newVal : v)) : r
      );
      useStore.setState({
        tableData: props.result
          ? { ...(useStore.getState().tableData ?? ({} as any)), result: { ...result, rows: newRows } }
          : null,
        queryTabs: props.result
          ? useStore.getState().queryTabs
          : useStore.getState().queryTabs.map((t) =>
              t.id === tab?.id ? { ...t, result: { ...result, rows: newRows } } : t
            ),
      });
      setSavedRows({ ...result, rows: newRows });
      setEdit(null);
      // autosave: pindah baris setelah commit
      if (dir === "down" && rowIdx + 1 < result.rows.length) {
        setEdit({ rowIdx: rowIdx + 1, colIdx, value: String(newRows[rowIdx + 1][colIdx] ?? ""), isNull: newRows[rowIdx + 1][colIdx] === null });
      } else if (dir === "up" && rowIdx > 0) {
        setEdit({ rowIdx: rowIdx - 1, colIdx, value: String(newRows[rowIdx - 1][colIdx] ?? ""), isNull: newRows[rowIdx - 1][colIdx] === null });
      }
    } catch (e: any) {
      alert(`Update gagal: ${e}`);
      setEdit(null);
    }
  };

  const deleteRows = async (idxs: number[]) => {
    if (!result || !editable || idxs.length === 0) return;
    if (!window.confirm(`Hapus ${idxs.length} baris dari tabel?`)) return;
    for (const i of idxs) {
      const sql = `DELETE FROM ${quote(String(props.database))}.${quote(String(props.tableName))} WHERE ${whereForRow(result.rows[i])}`;
      try {
        await invoke("execute", { id: props.connId, sql });
      } catch (e: any) {
        alert(`Delete baris ${i + 1} gagal: ${e}`);
        break;
      }
    }
    useStore.setState({ statusMessage: `${idxs.length} row(s) deleted` });
    if (props.onRefresh) props.onRefresh();
  };

  const insertRow = async () => {
    if (!result || !editable) return;
    const cols = result.columns.map((c) => quote(c)).join(", ");
    const sql = `INSERT INTO ${quote(String(props.database))}.${quote(String(props.tableName))} (${cols}) VALUES (${result.columns.map(() => "DEFAULT").join(", ")})`;
    try {
      await invoke("execute", { id: props.connId, sql });
      useStore.setState({ statusMessage: "1 row inserted (default values)" });
      if (props.onRefresh) props.onRefresh();
    } catch (e: any) {
      alert(`Insert gagal: ${e}`);
    }
  };

  const duplicateRow = async (rowIdx: number) => {
    if (!result || !editable) return;
    const row = result.rows[rowIdx];
    const cols = result.columns.map((c) => quote(c)).join(", ");
    const vals = row.map((v) => (pkColumns.includes(result.columns[row.indexOf(v)]) ? "DEFAULT" : sqlValue(v)));
    const sql = `INSERT INTO ${quote(String(props.database))}.${quote(String(props.tableName))} (${cols}) VALUES (${vals.join(", ")})`;
    try {
      await invoke("execute", { id: props.connId, sql });
      useStore.setState({ statusMessage: "1 row duplicated" });
      if (props.onRefresh) props.onRefresh();
    } catch (e: any) {
      alert(`Duplicate gagal: ${e}`);
    }
  };

  // ================= build content utk export/copy =================
  const buildContent = (format: CopyFormat, rowsOnly: boolean, includeHeader: boolean) => {
    if (!result) return "";
    const selRows = rowsOnly && selected.size > 0
      ? result.rows.filter((_, i) => selected.has(i))
      : result.rows;
    if (format === "json") {
      return JSON.stringify(
        selRows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]]))),
        null,
        2
      );
    }
    if (format === "sql") {
      const t = quote(String(props.tableName ?? "result"));
      return selRows
        .map(
          (r) =>
            `INSERT INTO ${t} (${result.columns.map(quote).join(", ")}) VALUES (${r.map(sqlValue).join(", ")});`
        )
        .join("\n");
    }
    if (format === "html") {
      const esc = (v: any) => String(v ?? "NULL").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const th = includeHeader ? `<tr>${result.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>` : "";
      const trs = selRows
        .map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`)
        .join("\n");
      return `<table border="1">\n${th}${trs}\n</table>`;
    }
    const sep = format === "csv" ? "," : "\t";
    const esc = (v: any) =>
      v === null ? "NULL" : /[",\n\t]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const header = includeHeader ? [result.columns.map(esc).join(sep)] : [];
    return [...header, ...selRows.map((r) => r.map(esc).join(sep))].join("\n");
  };

  const doCopy = (format: CopyFormat, rowsOnly: boolean, includeHeader: boolean) => {
    const content = buildContent(format, rowsOnly, includeHeader);
    navigator.clipboard.writeText(content);
    useStore.setState({ statusMessage: `Copied as ${format.toUpperCase()}` });
    setCopyModal(false);
  };

  const doExport = async (format: CopyFormat, rowsOnly: boolean, includeHeader: boolean) => {
    const content = buildContent(format, rowsOnly, includeHeader);
    const file = await save({
      title: `Export hasil (${format.toUpperCase()})`,
      defaultPath: `${props.tableName ?? "result"}.${format}`,
    });
    if (file) {
      await writeTextFile(file, content);
      useStore.setState({ statusMessage: `Exported: ${file}` });
    }
    setCopyModal(false);
  };

  // ================= render =================
  if (!result)
    return <div className="data-grid empty">Jalankan query (F9) atau pilih tabel.</div>;

  if (!result.is_select) {
    const qErr = useStore.getState().queryError;
    return (
      <div className="data-grid">
        {qErr && !editable && <div className="grid-error">⚠ {qErr}</div>}
        <div className="grid-messages">
          ✔ {result.rows_affected} row(s) affected — {result.duration_ms} ms
        </div>
      </div>
    );
  }

  const allChecked = selected.size > 0 && selected.size === result.rows.length;
  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(result.rows.map((_, i) => i)));
  };
  const toggleRow = (i: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  };

  const fkFor = (col: string) =>
    tableSchema?.foreign_keys.find((f) => f.column.toLowerCase() === col.toLowerCase());

  // ===== filter & sorting client-side =====
  const applyFilters = (rows: any[][]) => {
    if (filters.length === 0) return rows;
    return rows.filter((r) =>
      filters.every((f) => {
        const raw = r[result.columns.indexOf(f.col)];
        const cell = raw === null ? null : String(raw);
        const val = f.value;
        switch (f.op) {
          case "=": return cell !== null && cell === val;
          case "<>": return cell === null || cell !== val;
          case "<": return cell !== null && Number(cell) < Number(val);
          case ">": return cell !== null && Number(cell) > Number(val);
          case "<=": return cell !== null && Number(cell) <= Number(val);
          case ">=": return cell !== null && Number(cell) >= Number(val);
          case "LIKE": return cell !== null && cell.toLowerCase().includes(val.toLowerCase());
          case "IS NULL": return cell === null;
          case "NOT NULL": return cell !== null;
          default: return true;
        }
      })
    );
  };

  const applySort = (rows: any[][]) => {
    if (!sort) return rows;
    const ci = result.columns.indexOf(sort.col);
    if (ci < 0) return rows;
    return [...rows].sort((a, b) => {
      const x = a[ci], y = b[ci];
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const xn = Number(x), yn = Number(y);
      const cmp = !isNaN(xn) && !isNaN(yn) ? xn - yn : String(x).localeCompare(String(y));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  };

  const viewRows = applySort(applyFilters(result.rows));

  // window baris yang dirender (dengan buffer atas/bawah)
  const total = viewRows.length;
  const vStart = Math.max(0, Math.floor(scrollTop / ROW_H) - 15);
  const vEnd = Math.min(total, vStart + Math.ceil(viewH / ROW_H) + 30);
  const renderedRows = viewRows.slice(vStart, vEnd);

  const cycleSort = (col: string) => {
    setSort((s) =>
      !s || s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null
    );
  };

  return (
    <div className="data-grid">
      <div className="grid-toolbar">
        {editable && (
          <>
            <button onClick={insertRow}>+ Row</button>
            {selected.size > 0 && (
              <button
                className="danger-text"
                onClick={() => deleteRows([...selected])}
              >
                Hapus ({selected.size})
              </button>
            )}
            {edit && dirty && (
              <span className="edit-actions">
                <button className="primary" title="Simpan perubahan" onClick={() => commitEdit()}>✔ Simpan</button>
                <button title="Batalkan edit" onClick={() => setEdit(null)}>✕ Batal</button>
                <span className="muted small">autosave saat pindah baris (Enter / ↑↓)</span>
              </span>
            )}
          </>
        )}
        <span className="spacer" />
        {editable && (
          <span className="limit-box">
            Limit:
            <select
              value={props.showAll ? "all" : String(props.limit ?? 1000)}
              onChange={(e) => {
                if (e.target.value === "all") {
                  props.onShowAllChange?.(true);
                } else {
                  props.onShowAllChange?.(false);
                  props.onLimitChange?.(Number(e.target.value));
                }
              }}
            >
              {[100, 500, 1000, 5000].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
              <option value="all">Semua</option>
            </select>
          </span>
        )}
        <button
          className={filters.length > 0 ? "filter-on" : ""}
          title="Filter baris (multi kolom)"
          onClick={() => setShowFilter(true)}
        >
          🔍 Filter{filters.length > 0 ? ` (${filters.length})` : ""}
        </button>
        <button onClick={() => { setCopyModalMode("copy"); setCopyModal(true); }}>Copy…</button>
        <button onClick={() => { setCopyModalMode("export"); setCopyModal(true); }}>Export…</button>
        {props.paging && (
          <span className="paging">
            <button
              disabled={(props.offset ?? 0) === 0}
              onClick={() => props.onOffsetChange?.(Math.max(0, (props.offset ?? 0) - (props.limit ?? 200)))}
            >
              ‹ Prev
            </button>
            <span>
              {props.offset ?? 0}–{(props.offset ?? 0) + result.rows.length}
            </span>
            <button
              disabled={result.rows.length < (props.limit ?? 200) || props.showAll}
              onClick={() => props.onOffsetChange?.((props.offset ?? 0) + (props.limit ?? 200))}
            >
              Next ›
            </button>
          </span>
        )}
      </div>
      <div
        className="grid-scroll"
        ref={gridRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <table>
          <thead>
            <tr>
              {editable && (
                <th className="check-col">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </th>
              )}
              {editable && <th className="rownum-col">#</th>}
              {result.columns.map((c) => {
                const fk = fkFor(c);
                const sortMark = sort?.col === c ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
                const sortable = props.tableName !== undefined;
                return (
                  <th
                    key={c}
                    className={fk ? "fk-col" : (sort?.col === c ? "sorted" : "")}
                    onClick={sortable ? () => cycleSort(c) : undefined}
                    title={sortable ? "Klik: sort ASC → DESC → matikan" : undefined}
                  >
                    {fk ? (
                      <>
                        <span
                          className="fk-link"
                          title={`Relasi → ${fk.ref_table}.${fk.ref_column} (klik utk lihat tabel sumber)`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRelModal({ refTable: fk.ref_table, refColumn: fk.ref_column, column: c });
                          }}
                        >
                          🔗 {c}
                        </span>
                        {sortMark}
                      </>
                    ) : (
                      <>{c}{sortMark}</>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {vStart > 0 && (
              <tr style={{ height: vStart * ROW_H }} aria-hidden="true"><td colSpan={result.columns.length + 2} style={{ padding: 0, border: "none" }}></td></tr>
            )}
            {renderedRows.map((row, wi) => {
              const i = vStart + wi;
              return (
              <tr key={i} className={selected.has(i) ? "selected" : ""}>
                {editable && (
                  <td className="check-col">
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggleRow(i)}
                    />
                  </td>
                )}
                {editable && (
                  <td className="rownum-col">
                    <span className="rownum">{(props.offset ?? 0) + i + 1}</span>
                    <button className="row-del" title="Hapus baris" onClick={() => deleteRows([i])}>
                      ✕
                    </button>
                    <button className="row-dup" title="Duplikat baris" onClick={() => duplicateRow(i)}>
                      ⧉
                    </button>
                  </td>
                )}
                {row.map((v, j) => {
                  const editing = edit && edit.rowIdx === i && edit.colIdx === j;
                  return (
                    <td
                      key={j}
                      className={v === null ? "null" : ""}
                      onDoubleClick={() => {
                        if (!editable) return;
                        setEdit({
                          rowIdx: i,
                          colIdx: j,
                          value: v === null ? "" : String(v),
                          isNull: v === null,
                        });
                      }}
                    >
                      {editing ? (
                        <span className="cell-edit">
                          <input
                            autoFocus
                            value={edit.isNull ? "" : edit.value}
                            placeholder={edit.isNull ? "NULL" : ""}
                            onChange={(e) =>
                              setEdit({ ...edit, value: e.target.value, isNull: false })
                            }
                            onBlur={() => { if (dirty) commitEdit(); else setEdit(null); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); commitEdit("down"); }
                              if (e.key === "Escape") setEdit(null);
                              if (e.key === "ArrowDown") { e.preventDefault(); commitEdit("down"); }
                              if (e.key === "ArrowUp") { e.preventDefault(); commitEdit("up"); }
                              if (e.key === "Tab") { e.preventDefault(); commitEdit(); }
                            }}
                          />
                          <button
                            title="Set NULL"
                            onClick={() => setEdit({ ...edit, isNull: !edit.isNull })}
                          >
                            ∅
                          </button>
                        </span>
                      ) : v === null ? (
                        "NULL"
                      ) : (
                        String(v)
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
            {vEnd < total && (
              <tr style={{ height: (total - vEnd) * ROW_H }} aria-hidden="true"><td colSpan={result.columns.length + 2} style={{ padding: 0, border: "none" }}></td></tr>
            )}
            {filters.length > 0 && total === 0 && (
              <tr><td colSpan={result.columns.length + 2} className="muted">Tidak ada baris yang cocok dengan filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* modal pilihan format copy/export */}
      {copyModal && (
        <div className="modal-backdrop" onClick={() => setCopyModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{copyModalMode === "copy" ? "Copy Data" : "Export Data"}</h2>
            <p className="hint">
              Format data — {selected.size > 0 ? `${selected.size} baris terpilih` : `semua ${result.rows.length} baris (pilih via checkbox utk sebagian)`}
            </p>
            <div className="format-grid">
              {(["tsv", "csv", "json", "sql", "html"] as CopyFormat[]).map((f) => (
                <label key={f} className="check">
                  <input type="radio" name="copyfmt" defaultChecked={f === "tsv"} />
                  {f.toUpperCase()}
                </label>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" id="copy-header" defaultChecked />
              Sertakan nama kolom (header)
            </label>
            <label className="check">
              <input type="checkbox" id="copy-rowsonly" defaultChecked={selected.size > 0} />
              Hanya baris terpilih ({selected.size || 0})
            </label>
            <div className="modal-actions">
              <button onClick={() => setCopyModal(false)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  const fmt = (document.querySelector('input[name="copyfmt"]:checked') as HTMLInputElement)?.value as CopyFormat ?? "tsv";
                  const header = (document.getElementById("copy-header") as HTMLInputElement)?.checked ?? true;
                  const rowsOnly = (document.getElementById("copy-rowsonly") as HTMLInputElement)?.checked ?? false;
                  if (copyModalMode === "copy") doCopy(fmt, rowsOnly, header);
                  else doExport(fmt, rowsOnly, header);
                }}
              >
                {copyModalMode === "copy" ? "Copy ke clipboard" : "Simpan file…"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* modal filter multi kolom */}
      {showFilter && (
        <div className="modal-backdrop" onClick={() => setShowFilter(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🔍 Filter Baris</h2>
            <p className="hint">
              Kondisi digabung dengan AND. Baris terpilih di datatable otomatis jadi default kolom pertama.
            </p>
            {filters.map((f, i) => (
              <div key={i} className="row nowrap filter-row">
                <select
                  value={f.col}
                  onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, col: e.target.value } : x)))}
                >
                  {result.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  className="w70"
                  value={f.op}
                  onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}
                >
                  {["=", "<>", "<", ">", "<=", ">=", "LIKE", "IS NULL", "NOT NULL"].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                <input
                  className="grow"
                  placeholder="nilai"
                  disabled={f.op === "IS NULL" || f.op === "NOT NULL"}
                  value={f.value}
                  onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
                <button onClick={() => setFilters(filters.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button
              onClick={() => {
                // default kolom pertama: kolom cell yang sedang diseleksi (atau kolom pertama)
                const lastEditCol = edit ? result.columns[edit.colIdx] : result.columns[0];
                setFilters([...filters, { col: lastEditCol ?? result.columns[0], op: "=", value: "" }]);
              }}
            >
              + Tambah Kondisi
            </button>
            <div className="modal-actions">
              <button onClick={() => { setFilters([]); setShowFilter(false); }}>Reset</button>
              <button className="primary" onClick={() => setShowFilter(false)}>Terapkan</button>
            </div>
          </div>
        </div>
      )}

      {/* modal relasi: tampilkan data tabel sumber */}
      {relModal && (
        <RelationModal
          connId={props.connId ?? activeConnId}
          database={props.database ?? ""}
          refTable={relModal.refTable}
          refColumn={relModal.refColumn}
          value={result.rows.find((r) => r !== null)?.[result.columns.indexOf(relModal.column)]}
          onClose={() => setRelModal(null)}
        />
      )}
    </div>
  );
}

/** Modal yang menampilkan isi tabel sumber relasi (FK). */
function RelationModal({
  connId,
  database,
  refTable,
  refColumn,
  value,
  onClose,
}: {
  connId: string | null;
  database: string;
  refTable: string;
  refColumn: string;
  value: any;
  onClose: () => void;
}) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [filter, setFilter] = useState<string>(value === null || value === undefined ? "" : String(value));
  const [err, setErr] = useState<string | null>(null);
  const conn = useStore((s) => s.connections.find((c) => c.id === connId));
  const q = (n: string) => (conn?.dbType === "mysql" ? `\`${n}\`` : `"${n}"`);

  const load = async (f: string) => {
    if (!connId) return;
    try {
      setErr(null);
      const where = f ? ` WHERE ${q(refColumn)} = ${typeof f === "string" && f !== "" && !isNaN(Number(f)) ? f : `'${f.replace(/'/g, "''")}'`}` : "";
      const sql = `SELECT * FROM ${q(database)}.${q(refTable)}${where} LIMIT 200`;
      const r = await invoke<QueryResult>("execute", { id: connId, sql });
      setResult(r);
    } catch (e: any) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    if (value !== null && value !== undefined) load(String(value));
    else load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>🔗 Relasi: {refTable}.{refColumn}</h2>
        <div className="row">
          <label className="grow">
            Filter {refColumn}
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(filter)}
              placeholder="kosong = semua"
            />
          </label>
          <button onClick={() => load(filter)}>Cari</button>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="rel-table">
          {result ? (
            <table>
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c} className={c === refColumn ? "fk-col" : ""}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={v === null ? "null" : ""}>{v === null ? "NULL" : String(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">Memuat…</div>
          )}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  );
}
