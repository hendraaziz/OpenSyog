import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

interface MenuDef {
  label: string;
  items: { label: string; onClick?: () => void; shortcut?: string; disabled?: boolean; sep?: boolean }[];
}

export default function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const s = useStore.getState();
  const activeConn = s.connections.find((c) => c.id === s.activeConnId);
  const activeTab = s.queryTabs.find((t) => t.id === s.activeQueryTabId);
  const canRun = Boolean(activeConn && activeTab);

  const run = (sql: string, confirmMsg?: string) => {
    if (!activeConn) return alert("Tidak ada koneksi aktif");
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("execute", { id: activeConn.id, sql })
        .then(() => s.refreshConn(activeConn.id))
        .then(() => {
          if (activeConn.activeDatabase)
            return s.selectDatabase(activeConn.id, activeConn.activeDatabase);
        })
        .catch((e) => alert(`SQL gagal: ${e}`))
    );
  };

  const promptDb = () => {
    const name = window.prompt("Nama database baru:");
    if (!name || !activeConn) return;
    const q = activeConn.dbType === "mysql" ? `\`${name}\`` : `"${name}"`;
    run(`CREATE DATABASE ${q}`);
  };

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        {
          label: "New Query Tab",
          shortcut: "Ctrl+T",
          disabled: !activeConn,
          onClick: () => activeConn && s.newQueryTab(activeConn.id),
        },
        { label: "Close Query Tab", shortcut: "Ctrl+W", disabled: !activeTab, onClick: () => activeTab && s.closeQueryTab(activeTab.id) },
        { sep: true, label: "" },
        {
          label: "New Connection…",
          onClick: () => window.dispatchEvent(new CustomEvent("opensyog:new-connection")),
        },
        {
          label: "Disconnect",
          disabled: !activeConn,
          onClick: () => activeConn && s.closeConn(activeConn.id),
        },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo (di editor)", shortcut: "Ctrl+Z", disabled: true },
        { sep: true, label: "" },
        { label: "Copy as TSV (hasil)", disabled: !activeTab?.result, onClick: () => document.dispatchEvent(new CustomEvent("opensyog:copy-tsv")) },
      ],
    },
    {
      label: "Database",
      items: [
        { label: "Create Database…", disabled: !activeConn, onClick: promptDb },
        {
          label: "Drop Current Database",
          disabled: !activeConn?.activeDatabase,
          onClick: () => {
            const db = activeConn?.activeDatabase!;
            const q = activeConn?.dbType === "mysql" ? `\`${db}\`` : `"${db}"`;
            run(`DROP DATABASE ${q}`, `Hapus database ${db} + seluruh isinya??`);
          },
        },
        { sep: true, label: "" },
        {
          label: "Refresh Databases (F5)",
          disabled: !activeConn,
          onClick: () => activeConn && s.refreshConn(activeConn.id),
        },
      ],
    },
    {
      label: "Table",
      items: [
        {
          label: "Edit Data tabel terpilih",
          disabled: !s.tableData,
          onClick: () => s.setBottomTab("table"),
        },
        {
          label: "Truncate tabel terpilih",
          disabled: !s.tableData,
          onClick: () => {
            const td = s.tableData!;
            const q =
              activeConn?.dbType === "mysql"
                ? `\`${td.database}\`.\`${td.table}\``
                : `"${td.database}"."${td.table}"`;
            run(`TRUNCATE TABLE ${q}`, `Kosongkan tabel ${td.table}?`);
          },
        },
        {
          label: "Drop tabel terpilih",
          disabled: !s.tableData,
          onClick: () => {
            const td = s.tableData!;
            const q =
              activeConn?.dbType === "mysql"
                ? `\`${td.database}\`.\`${td.table}\``
                : `"${td.database}"."${td.table}"`;
            run(`DROP TABLE ${q}`, `Hapus tabel ${td.table}?`);
          },
        },
      ],
    },
    {
      label: "Tools",
      items: [
        { label: "Execute Query", shortcut: "F9", disabled: !canRun, onClick: () => activeTab && s.runQuery(activeTab.id) },
        { label: "Refresh Tree", shortcut: "F5", disabled: !activeConn, onClick: () => activeConn && s.refreshConn(activeConn.id) },
        { sep: true, label: "" },
        { label: "Export Result (CSV)", disabled: !activeTab?.result, onClick: () => document.dispatchEvent(new CustomEvent("opensyog:export-csv")) },
        { sep: true, label: "" },
        {
          label: "User Management…",
          disabled: !activeConn,
          onClick: () => window.dispatchEvent(new CustomEvent("opensyog:user-management")),
        },
      ],
    },
    {
      label: "Help",
      items: [{ label: "About OpenSyog", onClick: () => alert("OpenSyog 0.1.0\nMulti-OS MySQL/MariaDB/PostgreSQL client") }],
    },
  ];

  return (
    <div className="menubar-nav" ref={barRef}>
      {menus.map((m) => (
        <div
          key={m.label}
          className={"nav-menu" + (open === m.label ? " open" : "")}
          onMouseEnter={() => open && setOpen(m.label)}
        >
          <div className="nav-label" onClick={() => setOpen(open === m.label ? null : m.label)}>
            {m.label}
          </div>
          {open === m.label && (
            <div className="nav-dropdown">
              {m.items.map((it, i) =>
                it.sep ? (
                  <div key={i} className="cm-sep" />
                ) : (
                  <div
                    key={i}
                    className={"cm-item" + (it.disabled ? " disabled" : "")}
                    onClick={() => {
                      if (it.disabled) return;
                      it.onClick?.();
                      setOpen(null);
                    }}
                  >
                    <span>{it.label}</span>
                    {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
