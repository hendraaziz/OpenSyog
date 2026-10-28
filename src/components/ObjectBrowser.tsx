import { useState } from "react";
import { useStore } from "../store";
import ContextMenu, { MenuItem } from "./ContextMenu";

const GROUPS: { key: keyof DbObjects; label: string; icon: string }[] = [
  { key: "tables", label: "Tables", icon: "▤" },
  { key: "views", label: "Views", icon: "◫" },
  { key: "procedures", label: "Stored Procedures", icon: "⚙" },
  { key: "functions", label: "Functions", icon: "ƒ" },
  { key: "triggers", label: "Triggers", icon: "⚡" },
  { key: "events", label: "Events", icon: "◷" },
];

type DbObjects = {
  tables: string[];
  views: string[];
  procedures: string[];
  functions: string[];
  triggers: string[];
  events: string[];
};

type MenuTarget =
  | { kind: "db"; connId: string; db: string }
  | { kind: "table"; connId: string; db: string; table: string; objType: string }
  | { kind: "group"; connId: string; db: string; group: string }
  | { kind: "server"; connId: string }
  | null;

export default function ObjectBrowser() {
  const { connections, activeConnId, tableFilter, setTableFilter } = useStore();
  const [menu, setMenu] = useState<MenuTarget>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const conn = connections.find((c) => c.id === activeConnId);
  if (!conn) return null;

  /** buka tab Manage Table / Schema Designer (seperti tab query) */
  const openDesigner = (cid: string, db: string, table: string | null, kind: "table-designer" | "schema-designer" = "table-designer") =>
    useStore.getState().openDesignerTab(cid, db, table, kind);

  const f = tableFilter.toLowerCase();

  const runSql = async (connId: string, sql: string, refreshDb?: string) => {
    try {
      await import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("execute", { id: connId, sql })
      );
      if (refreshDb) {
        await useStore.getState().refreshConn(connId);
        await useStore.getState().selectDatabase(connId, refreshDb);
      }
    } catch (e: any) {
      alert(`SQL gagal: ${e}`);
    }
  };

  const confirm = (msg: string) => window.confirm(msg);

  const groupMenu = (target: Extract<MenuTarget, { kind: "group" }>): MenuItem[] => {
    const { connId, db, group } = target;
    const items: MenuItem[] = [];
    if (group === "tables") {
      items.push({
        label: "Create Table…",
        onClick: () => openDesigner(connId, db, null),
      });
    }
    if (group === "views") {
      items.push({
        label: "Create View…",
        onClick: () => {
          useStore.getState().newQueryTab(connId);
          const tabs = useStore.getState().queryTabs;
          const t = tabs[tabs.length - 1];
          if (t) useStore.getState().setQueryText(t.id, `CREATE OR REPLACE VIEW \`${db}\`.\`new_view\` AS\nSELECT ...;\n`);
        },
      });
    }
    if (group === "procedures") {
      items.push({
        label: "Create Procedure…",
        onClick: () => {
          useStore.getState().newQueryTab(connId);
          const tabs = useStore.getState().queryTabs;
          const t = tabs[tabs.length - 1];
          if (t) useStore.getState().setQueryText(t.id, `DELIMITER //\nCREATE PROCEDURE \`${db}\`.new_proc(IN p_id INT)\nBEGIN\n  SELECT * FROM tabel WHERE id = p_id;\nEND //\nDELIMITER ;\n`);
        },
      });
    }
    if (group === "functions") {
      items.push({
        label: "Create Function…",
        onClick: () => {
          useStore.getState().newQueryTab(connId);
          const tabs = useStore.getState().queryTabs;
          const t = tabs[tabs.length - 1];
          if (t) useStore.getState().setQueryText(t.id, `CREATE FUNCTION \`new_func\`(p INT) RETURNS INT\nBEGIN\n  RETURN p * 2;\nEND;\n`);
        },
      });
    }
    if (group === "triggers") {
      items.push({
        label: "Create Trigger…",
        onClick: () => {
          useStore.getState().newQueryTab(connId);
          const tabs = useStore.getState().queryTabs;
          const t = tabs[tabs.length - 1];
          if (t) useStore.getState().setQueryText(t.id, `CREATE TRIGGER \`new_trg\` AFTER INSERT ON \`${db}\`.\`tabel\`\nFOR EACH ROW\nBEGIN\n  -- aksi\nEND;\n`);
        },
      });
    }
    if (group === "events") {
      items.push({
        label: "Create Event…",
        onClick: () => {
          useStore.getState().newQueryTab(connId);
          const tabs = useStore.getState().queryTabs;
          const t = tabs[tabs.length - 1];
          if (t) useStore.getState().setQueryText(t.id, `CREATE EVENT \`new_event\`\nON SCHEDULE EVERY 1 DAY\nDO\n  CALL some_proc();\n`);
        },
      });
    }
    items.push(
      { separator: true, label: "" },
      {
        label: "Refresh",
        onClick: async () => {
          await useStore.getState().refreshConn(connId);
          await useStore.getState().selectDatabase(connId, db);
        },
      }
    );
    return items;
  };

  const serverMenu = (target: Extract<MenuTarget, { kind: "server" }>): MenuItem[] => {
    const { connId } = target;
    const c = useStore.getState().connections.find((x) => x.id === connId);
    return [
      {
        label: "New Query Tab",
        onClick: () => useStore.getState().newQueryTab(connId),
      },
      {
        label: "Refresh Tree",
        onClick: async () => {
          await useStore.getState().refreshConn(connId);
          if (c?.activeDatabase) await useStore.getState().selectDatabase(connId, c.activeDatabase);
        },
      },
      {
        label: "Set as Active Connection",
        onClick: () => useStore.getState().setActiveConn(connId),
      },
      { separator: true, label: "" },
      {
        label: "Copy Name",
        onClick: () => navigator.clipboard.writeText(c?.name ?? ""),
      },
      {
        label: "Disconnect",
        onClick: () => useStore.getState().closeConn(connId),
      },
    ];
  };

  const dbMenu = (target: Extract<MenuTarget, { kind: "db" }>): MenuItem[] => {
    const { connId, db } = target;
    const c = useStore.getState().connections.find((x) => x.id === connId);
    const isMysql = c?.dbType === "mysql";
    const q = (s: string) => (isMysql ? `\`${db}\`` : `"${db}"`);
    return [
      {
        label: "Refresh",
        onClick: async () => {
          await useStore.getState().refreshConn(connId);
          await useStore.getState().selectDatabase(connId, db);
        },
      },
      { separator: true, label: "" },
      {
        label: "Schema Designer",
        onClick: () => openDesigner(connId, db, null, "schema-designer"),
      },
      {
        label: "Create Database…",
        onClick: () => {
          const name = window.prompt("Nama database baru:");
          if (name)
            runSql(
              connId,
              `CREATE DATABASE ${isMysql ? `\`${name}\`` : `"${name}"`}`
            );
        },
      },
      {
        label: "Alter Database…",
        disabled: true,
      },
      {
        label: "Drop Database",
        onClick: () => {
          if (
            confirm(
              `Yakin hapus database ${db} beserta SELURUH isinya? Tidak bisa dibatalkan!`
            )
          )
            runSql(connId, `DROP DATABASE ${q(db)}`, db);
        },
      },
      { separator: true, label: "" },
      {
        label: "Copy Name",
        onClick: () => navigator.clipboard.writeText(db),
      },
      {
        label: "Set as Active",
        onClick: () => useStore.getState().selectDatabase(connId, db),
      },
    ];
  };

  const tableMenu = (target: Extract<MenuTarget, { kind: "table" }>): MenuItem[] => {
    const { connId, db, table, objType } = target;
    const c = useStore.getState().connections.find((x) => x.id === connId);
    const isMysql = c?.dbType === "mysql";
    const isTable = objType === "tables";
    const tq = (s: string) => (isMysql ? `\`${s}\`` : `"${s}"`);
    const fq = `${isMysql ? `\`${db}\`` : `"${db}"`}.${tq(table)}`;

    // buka template SQL di tab query baru
    const openSqlTab = (sql: string) => {
      useStore.getState().newQueryTab(connId);
      const tabs = useStore.getState().queryTabs;
      const t = tabs[tabs.length - 1];
      if (t) useStore.getState().setQueryText(t.id, sql);
    };

    const items: MenuItem[] = [
      {
        label: "Open Table",
        onClick: () => {
          useStore.getState().selectDatabase(connId, db).then(() =>
            useStore.getState().selectTable(connId, table)
          );
        },
      },
      {
        label: "View Structure (DESC)",
        onClick: () => {
          const sql = isMysql ? `DESC ${fq}` : `\\d ${fq}`;
          if (!isMysql) {
            runSql(connId, `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='${table}' AND table_schema='public'`);
          } else runSql(connId, sql);
        },
      },
    ];

    if (isTable) {
      items.push(
        { separator: true, label: "" },
        {
          label: "Create Table…",
          onClick: () => {
            openDesigner(connId, db, null);
          },
        },
        {
          label: "Alter Table…",
          onClick: () => {
            openDesigner(connId, db, table);
          },
        },
        {
          label: "Schema Designer",
          onClick: () => openDesigner(connId, db, null, "schema-designer"),
        },
        {
          label: "Manage Relations…",
          onClick: () => {
            const schema = c?.schema?.find((s) => s.table === table);
            const fks = schema?.foreign_keys ?? [];
            const fkList = fks.length
              ? fks.map((f) => `  -- ${f.column} → ${f.ref_table}.${f.ref_column}`).join("\n")
              : "  -- (belum ada relasi)";
            openSqlTab(
              `-- Relasi tabel ${table}:\n${fkList}\n\n-- Tambah relasi baru:\nALTER TABLE ${fq}\n  ADD CONSTRAINT fk_${table}_relasi\n  FOREIGN KEY (kolom_fk) REFERENCES ${isMysql ? "`tabel_sumber`" : '"tabel_sumber"'} (kolom_pk)\n  ON DELETE CASCADE ON UPDATE CASCADE;\n`
            );
          },
        },
        { separator: true, label: "" },
        {
          label: "Rename Table…",
          onClick: () => {
            const name = window.prompt(`Rename ${table} menjadi:`);
            if (name)
              runSql(
                connId,
                `ALTER TABLE ${fq} RENAME TO ${isMysql ? `\`${name}\`` : `"${name}"`}`,
                db
              );
          },
        },
        {
          label: "Duplicate Table…",
          onClick: () => {
            const name = window.prompt(`Duplikat ${table} menjadi:`, `${table}_copy`);
            if (!name) return;
            const nq = isMysql ? `\`${name}\`` : `"${name}"`;
            if (isMysql) {
              runSql(connId, `CREATE TABLE ${nq} LIKE ${fq}`, db);
              runSql(connId, `INSERT INTO ${nq} SELECT * FROM ${fq}`, db);
            } else {
              runSql(connId, `CREATE TABLE ${nq} AS SELECT * FROM ${fq}`, db);
            }
          },
        },
        {
          label: "Truncate Table",
          onClick: () => {
            if (confirm(`Kosongkan semua data di ${table}?`))
              runSql(connId, `TRUNCATE TABLE ${fq}`, db);
          },
        },
        {
          label: "Drop Table",
          onClick: () => {
            if (confirm(`Hapus tabel ${table}? Struktur & data hilang!`))
              runSql(connId, `DROP TABLE ${fq}`, db);
          },
        }
      );
    }

    items.push(
      { separator: true, label: "" },
      {
        label: "Copy as SELECT *",
        onClick: () =>
          navigator.clipboard.writeText(`SELECT * FROM ${fq} LIMIT 100;`),
      },
      {
        label: "Copy as INSERT…",
        onClick: () => {
          const cols = window.prompt("Kolom (koma) atau kosong utk semua:");
          const cstr = cols ? ` (${cols})` : "";
          navigator.clipboard.writeText(
            `INSERT INTO ${fq}${cstr} VALUES ();`
          );
        },
      },
      { separator: true, label: "" },
      {
        label: "Backup / Dump SQL…",
        onClick: async () => {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const { invoke } = await import("@tauri-apps/api/core");
          const path = await save({
            title: `Dump ${table} ke file SQL`,
            defaultPath: `${db}_${table}.sql`,
            filters: [{ name: "SQL", extensions: ["sql"] }],
          });
          if (!path) return;
          try {
            const n = await invoke<number>("dump_table", {
              id: connId,
              database: db,
              table,
              path,
            });
            useStore
              .getState()
              .setStatus(`Dump ${table}: ${n} baris → ${path}`);
          } catch (e: any) {
            alert(`Dump gagal: ${e}`);
          }
        },
      },
      {
        label: "Import CSV…",
        onClick: async () => {
          const { open } = await import("@tauri-apps/plugin-dialog");
          const { invoke } = await import("@tauri-apps/api/core");
          const path = await open({
            title: `Import CSV ke ${table}`,
            filters: [{ name: "CSV", extensions: ["csv", "txt"] }],
            multiple: false,
          });
          if (!path || typeof path !== "string") return;
          if (
            !confirm(
              `Insert semua baris CSV ke ${fq}? Header CSV harus sama dengan kolom tabel.`
            )
          )
            return;
          try {
            const n = await invoke<number>("import_csv", {
              id: connId,
              database: db,
              table,
              path,
            });
            useStore.getState().setStatus(`Import CSV: ${n} baris → ${fq}`);
            useStore.getState().refreshConn(connId);
            useStore.getState().selectDatabase(connId, db);
          } catch (e: any) {
            alert(`Import gagal: ${e}`);
          }
        },
      },
      { separator: true, label: "" },
      { label: "Refresh", onClick: () => useStore.getState().refreshConn(connId) },
      { label: "Copy Name", onClick: () => navigator.clipboard.writeText(table) },
    );
    return items;
  };

  return (
    <div className="object-browser">
      <div className="ob-header">
        <input
          className="table-search"
          placeholder="Cari tabel…"
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
        />
      </div>
      <div className="ob-tree">
        {connections.map((c) => (
          <div key={c.id} className="ob-conn">
            <div
              className={"ob-node server" + (c.id === activeConnId ? " active" : "")}
              onClick={() => useStore.getState().setActiveConn(c.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuPos({ x: e.clientX, y: e.clientY });
                setMenu({ kind: "server", connId: c.id });
              }}
            >
              {c.dbType === "mysql" ? "🐬" : "🐘"} {c.name}
            </div>
            {c.id === activeConnId && (
              <div className="ob-children">
                {c.databases.map((db) => (
                  <div key={db}>
                    <div
                      className={"ob-node db" + (db === c.activeDatabase ? " active" : "")}
                      onClick={() => useStore.getState().selectDatabase(c.id, db)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuPos({ x: e.clientX, y: e.clientY });
                        setMenu({ kind: "db", connId: c.id, db });
                      }}
                    >
                      ▭ {db}
                    </div>
                    {db === c.activeDatabase && c.objects && (
                      <div className="ob-children">
                        {GROUPS.map((g) => {
                          const items = c.objects![g.key].filter(
                            (n) => !f || n.toLowerCase().includes(f)
                          );
                          if (f && items.length === 0 && g.key !== "tables")
                            return null;
                          return (
                            <div key={g.key}>
                              <div
                                className="ob-node group"
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setMenuPos({ x: e.clientX, y: e.clientY });
                                  setMenu({ kind: "group", connId: c.id, db, group: g.key });
                                }}
                              >
                                {g.icon} {g.label} ({c.objects![g.key].length})
                              </div>
                              <div className="ob-children">
                                {items.map((name) => (
                                  <div
                                    key={name}
                                    className="ob-node leaf"
                                    onClick={() =>
                                      g.key === "tables" || g.key === "views"
                                        ? useStore.getState().selectTable(c.id, name)
                                        : undefined
                                    }
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setMenuPos({ x: e.clientX, y: e.clientY });
                                      setMenu({
                                        kind: "table",
                                        connId: c.id,
                                        db,
                                        table: name,
                                        objType: g.key,
                                      });
                                    }}
                                  >
                                    {g.icon} {name}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {menu && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={
            menu.kind === "db"
              ? dbMenu(menu)
              : menu.kind === "server"
                ? serverMenu(menu)
                : menu.kind === "group"
                  ? groupMenu(menu)
                  : tableMenu(menu)
          }
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
