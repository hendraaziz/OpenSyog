import { useStore } from "../store";

export default function Toolbar() {
  const connections = useStore((s) => s.connections);
  const activeConnId = useStore((s) => s.activeConnId);
  const activeTabId = useStore((s) => s.activeQueryTabId);
  const conn = connections.find((c) => c.id === activeConnId) ?? null;

  return (
    <div className="toolbar2">
      {/* kiri: koneksi aktif + database dropdown */}
      {conn ? (
        <>
          <span className="tb-conn">
            {conn.dbType === "mysql" ? "🐬" : "🐘"} {conn.name}
          </span>
          <select
            className="tb-db"
            value={conn.activeDatabase ?? ""}
            onChange={(e) => useStore.getState().selectDatabase(conn.id, e.target.value)}
            title="Database aktif"
          >
            <option value="" disabled>
              — pilih database —
            </option>
            {conn.databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span className="tb-conn muted2">Belum ada koneksi aktif</span>
      )}

      <span className="tb-sep" />

      {/* tengah: aksi cepat */}
      <button
        title="Eksekusi query (F9)"
        disabled={!activeTabId || !conn}
        onClick={() => activeTabId && useStore.getState().runQuery(activeTabId)}
      >
        ▶ Execute
      </button>
      <button
        title="Tab query baru (Ctrl+T)"
        disabled={!conn}
        onClick={() => conn && useStore.getState().newQueryTab(conn.id)}
      >
        + Query
      </button>
      <button
        title="Refresh object browser (F5)"
        disabled={!conn}
        onClick={() => conn && useStore.getState().refreshConn(conn.id)}
      >
        ⟳ Refresh
      </button>
      <button
        title="Koneksi baru"
        onClick={() => window.dispatchEvent(new CustomEvent("opensyog:new-connection"))}
      >
        🔌 New Connection
      </button>

      <span className="spacer" />
      <span className="tb-info">
        {conn?.version ? <span className="tb-version">{conn.version}</span> : null}
      </span>
    </div>
  );
}
