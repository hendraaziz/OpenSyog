import { useEffect, useRef, useState } from "react";
import { useStore, SavedConnection } from "./store";
import ObjectBrowser from "./components/ObjectBrowser";
import SqlEditor from "./components/SqlEditor";
import DataGrid from "./components/DataGrid";
import ConnectionDialog from "./components/ConnectionDialog";
import MenuBar from "./components/MenuBar";
import Toolbar from "./components/Toolbar";
import TableInfo from "./components/TableInfo";
import UserManagement from "./components/UserManagement";

export default function App() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editConn, setEditConn] = useState<SavedConnection | null>(null);
  const [userMgmt, setUserMgmt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // tinggi editor query (px) — bisa ditarik via splitter
  const [editorH, setEditorH] = useState<number | null>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const {
    connections,
    activeConnId,
    savedList,
    loadSaved,
    connectSaved,
    setActiveConn,
    closeConn,
    bottomTab,
    tableData,
    history,
    statusMessage,
  } = useStore();

  useEffect(() => {
    loadSaved();
    const open = () => setDialogOpen(true);
    window.addEventListener("opensyog:new-connection", open);
    const um = () => setUserMgmt(true);
    window.addEventListener("opensyog:user-management", um);
    return () => {
      window.removeEventListener("opensyog:new-connection", open);
      window.removeEventListener("opensyog:user-management", um);
    };
  }, []);

  const activeConn = connections.find((c) => c.id === activeConnId) ?? null;

  /** Drag splitter antara SQL editor dan area bawah (datagrid) — ubah tinggi editor. */
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = centerRef.current;
    if (!container) return;
    const move = (ev: MouseEvent) => {
      const top = container.getBoundingClientRect().top;
      const h = Math.min(Math.max(ev.clientY - top, 60), container.clientHeight - 120);
      setEditorH(h);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const doConnectSaved = async (savedId: string) => {
    try {
      setError(null);
      await connectSaved(savedId);
    } catch (e: any) {
      setError(String(e));
    }
  };

  return (
    <div className="app">
      <div className="menubar">
        <span className="brand">OpenSyog</span>
        <MenuBar />
        <span className="spacer" />
        {connections.map((c) => (
          <span
            key={c.id}
            className={"conn-chip" + (c.id === activeConnId ? " active" : "")}
            onClick={() => setActiveConn(c.id)}
            title={c.version}
          >
            {c.dbType === "mysql" ? "🐬" : "🐘"} {c.name}
            <button
              className="chip-x"
              title="Disconnect"
              onClick={(e) => {
                e.stopPropagation();
                closeConn(c.id);
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {connections.length === 0 ? (
        <div className="welcome">
          <h1>OpenSyog</h1>
          <p>MySQL / MariaDB / PostgreSQL client — multi OS</p>
          <button className="big" onClick={() => setDialogOpen(true)}>
            New Connection
          </button>
          {savedList.length > 0 && (
            <div className="saved-list">
              <h3>Saved connections</h3>
              {savedList.map((sc) => (
                <div key={sc.id} className="saved-item" onClick={() => doConnectSaved(sc.id)}>
                  {sc.db_type === "mysql" ? "🐬" : "🐘"} {sc.name}
                  {sc.ssh && <span className="tag">SSH</span>}
                  <span className="muted">
                    {sc.host}:{sc.port}
                  </span>
                  <span className="saved-actions">
                    <button
                      className="mini"
                      title="Edit koneksi"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditConn(sc);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="mini danger"
                      title="Hapus koneksi tersimpan"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Hapus koneksi tersimpan "${sc.name}"?`)) {
                          useStore.getState().deleteSaved(sc.id);
                        }
                      }}
                    >
                      Hapus
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <Toolbar />
          <div className="main">
            <ObjectBrowser />
            <div className="center" ref={centerRef} style={editorH ? ({ ["--editor-h" as any]: `${editorH}px` } as React.CSSProperties) : undefined}>
              <SqlEditor />
              <div className="splitter-h" onMouseDown={startDrag} title="Tarik untuk ubah tinggi editor" />
              <div className="bottom-tabs">
                <span
                  className={"btab" + (bottomTab === "query" ? " active" : "")}
                  onClick={() => useStore.getState().setBottomTab("query")}
                >
                  Result
                </span>
                {tableData && (
                  <span
                    className={"btab" + (bottomTab === "table" ? " active" : "")}
                    onClick={() => useStore.getState().setBottomTab("table")}
                  >
                    Table Data: {tableData.table}
                    <button
                      className="chip-x"
                      onClick={(e) => {
                        e.stopPropagation();
                        useStore.getState().clearTableData();
                      }}
                    >
                      ×
                    </button>
                  </span>
                )}
                <span
                  className={"btab" + (bottomTab === "history" ? " active" : "")}
                  onClick={() => useStore.getState().setBottomTab("history")}
                >
                  History ({history.length})
                </span>
                {tableData && (
                  <span
                    className={"btab" + (bottomTab === "info" ? " active" : "")}
                    onClick={() => useStore.getState().setBottomTab("info")}
                  >
                    ℹ Info
                  </span>
                )}
              </div>
              {bottomTab === "info" && tableData ? (
                <TableInfo tableData={tableData} />
              ) : bottomTab === "history" ? (
                <div className="history-panel">
                  {history.length === 0 && (
                    <div className="muted">Belum ada query yang dijalankan.</div>
                  )}
                  {history.map((h, i) => (
                    <div key={i} className="history-item">
                      <code>{h.length > 200 ? h.slice(0, 200) + "…" : h}</code>
                      <button
                        className="mini"
                        title="Salin ke clipboard"
                        onClick={() => navigator.clipboard.writeText(h)}
                      >
                        Copy
                      </button>
                    </div>
                  ))}
                </div>
              ) : bottomTab === "table" && tableData ? (
                <DataGrid
                  tableName={tableData.table}
                  database={tableData.database}
                  connId={tableData.connId}
                  result={tableData.result}
                  limit={tableData.limit === 0 ? 1000 : tableData.limit}
                  offset={tableData.offset}
                  showAll={tableData.limit === 0}
                  onShowAllChange={(v) =>
                    useStore.getState().setTableLimit(v ? 0 : 1000)
                  }
                  onLimitChange={(l) => useStore.getState().setTableLimit(l)}
                  paging
                  onOffsetChange={(off) => useStore.getState().setTableOffset(off)}
                  onRefresh={() =>
                    useStore
                      .getState()
                      .loadTableData(
                        tableData.connId,
                        tableData.database,
                        tableData.table,
                        tableData.offset,
                        tableData.limit
                      )
                  }
                />
              ) : (
                <DataGrid />
              )}
            </div>
          </div>
          <div className="statusbar">
            <span>{activeConn?.name}</span>
            <span>{activeConn?.activeDatabase ?? "-"}</span>
            <span className="spacer" />
            <span>{statusMessage}</span>
            <span>{activeConn?.version}</span>
          </div>
        </>
      )}

      {dialogOpen && <ConnectionDialog onClose={() => setDialogOpen(false)} />}
      {editConn && (
        <ConnectionDialog
          edit={editConn}
          onClose={() => setEditConn(null)}
        />
      )}
      {userMgmt && <UserManagement onClose={() => setUserMgmt(false)} />}
    </div>
  );
}
