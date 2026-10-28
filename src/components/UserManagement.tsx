import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";

interface UserRow {
  name: string;
  host: string;
  superuser: boolean;
}

/** Modal manajemen user (MySQL: mysql.user; PostgreSQL: pg_user). */
export default function UserManagement({ onClose }: { onClose: () => void }) {
  const conn = useStore((s) => s.connections.find((c) => c.id === s.activeConnId));
  const [users, setUsers] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [grants, setGrants] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // form create user
  const [nu, setNu] = useState({ name: "", host: "%", password: "" });
  // form grant
  const [grantDb, setGrantDb] = useState(conn?.activeDatabase ?? "");

  const isMysql = conn?.dbType === "mysql";
  const databases = conn?.databases ?? [];

  const sql = async (s: string) => {
    if (!conn) throw new Error("Tidak ada koneksi aktif");
    return invoke("execute", { id: conn.id, sql: s });
  };

  const loadUsers = async () => {
    if (!conn) return;
    setErr(null);
    try {
      const r = await invoke<any>("execute", {
        id: conn.id,
        sql: isMysql
          ? "SELECT user, host, IF(super='Y' OR Super_priv='Y',1,0) AS su FROM mysql.user ORDER BY user, host"
          : "SELECT usename, COALESCE(rolsuper::text,'f'), '—' FROM pg_user ORDER BY usename",
      });
      setUsers(
        r.rows.map((row: any[]) => ({
          name: String(row[0] ?? ""),
          host: String(row[1] ?? ""),
          superuser: String(row[2]) === "1" || String(row[2]) === "true",
        }))
      );
    } catch (e: any) {
      setErr(`Gagal memuat daftar user (butuh hak akses): ${e}`);
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showGrants = async (u: UserRow) => {
    setSelected(u);
    setGrants("");
    try {
      const r = await invoke<any>("execute", {
        id: conn!.id,
        sql: isMysql ? `SHOW GRANTS FOR '${u.name}'@'${u.host}'` : `SELECT Has_database_privilege FROM pg_user WHERE usename='${u.name}'`,
      });
      setGrants(r.rows.map((row: any[]) => row.join(" — ")).join("\n") || "(tidak ada)");
    } catch (e: any) {
      setGrants(`(tidak bisa membaca grants: ${e})`);
    }
  };

  const run = async (s: string, okMsg: string) => {
    setBusy(true);
    setErr(null);
    try {
      await sql(s);
      setErr(okMsg);
      await loadUsers();
    } catch (e: any) {
      setErr(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const createUser = () => {
    if (!nu.name) return setErr("Nama user wajib diisi");
    const esc = nu.password.replace(/'/g, "''");
    if (isMysql) {
      run(`CREATE USER '${nu.name.replace(/'/g, "''")}'@'${nu.host}' IDENTIFIED BY '${esc}'`, `✔ User ${nu.name} dibuat`);
    } else {
      run(`CREATE USER "${nu.name.replace(/'/g, "''")}" WITH PASSWORD '${esc}'`, `✔ User ${nu.name} dibuat`);
    }
  };

  const dropUser = (u: UserRow) => {
    if (!window.confirm(`Hapus user ${u.name}${isMysql ? `@${u.host}` : ""}?`)) return;
    run(
      isMysql ? `DROP USER '${u.name}'@'${u.host}'` : `DROP USER "${u.name}"`,
      `✔ User ${u.name} dihapus`
    );
    setSelected(null);
  };

  const grantAll = () => {
    if (!selected || !grantDb) return;
    const g = grantDb.replace(/[`'"]/g, "");
    run(
      isMysql
        ? `GRANT ALL PRIVILEGES ON \`${g}\`.* TO '${selected.name}'@'${selected.host}'`
        : `GRANT ALL PRIVILEGES ON DATABASE "${g}" TO "${selected.name}"`,
      `✔ ALL PRIVILEGES pada ${grantDb} diberikan ke ${selected.name}`
    );
    showGrants(selected);
  };

  const revokeAll = () => {
    if (!selected || !grantDb) return;
    const g = grantDb.replace(/[`'"]/g, "");
    run(
      isMysql
        ? `REVOKE ALL PRIVILEGES ON \`${g}\`.* FROM '${selected.name}'@'${selected.host}'`
        : `REVOKE ALL PRIVILEGES ON DATABASE "${g}" FROM "${selected.name}"`,
      `✔ Semua privileges pada ${grantDb} dicabut dari ${selected.name}`
    );
    showGrants(selected);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide user-mgmt" onClick={(e) => e.stopPropagation()}>
        <h2>👥 User Management {conn ? `— ${conn.name}` : ""}</h2>
        {!conn ? (
          <div className="muted">Tidak ada koneksi aktif.</div>
        ) : (
          <div className="um-layout">
            <div className="um-users">
              <h3>Users</h3>
              {err && <div className="error">{err}</div>}
              <div className="um-list">
                {users.map((u) => (
                  <div
                    key={`${u.name}@${u.host}`}
                    className={"um-user" + (selected?.name === u.name && selected?.host === u.host ? " active" : "")}
                    onClick={() => showGrants(u)}
                  >
                    👤 {u.name}
                    {isMysql && <span className="muted">@{u.host}</span>}
                    {u.superuser && <span className="tag">super</span>}
                    <button
                      className="mini danger"
                      title="Hapus user"
                      onClick={(e) => {
                        e.stopPropagation();
                        dropUser(u);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {users.length === 0 && !err && <div className="muted">Tidak ada user / tidak punya akses.</div>}
              </div>

              <h3>Create User</h3>
              <div className="row">
                <label className="grow">
                  Username
                  <input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
                </label>
                {isMysql && (
                  <label className="small">
                    Host
                    <input value={nu.host} onChange={(e) => setNu({ ...nu, host: e.target.value })} />
                  </label>
                )}
              </div>
              <label>
                Password
                <input
                  type="password"
                  value={nu.password}
                  onChange={(e) => setNu({ ...nu, password: e.target.value })}
                />
              </label>
              <button className="primary" disabled={busy} onClick={createUser}>
                + Create User
              </button>
            </div>

            <div className="um-grants">
              <h3>Grants {selected ? `— ${selected.name}${isMysql ? `@${selected.host}` : ""}` : ""}</h3>
              {!selected ? (
                <div className="muted">Pilih user di kiri untuk melihat & mengubah privileges.</div>
              ) : (
                <>
                  <pre className="grants-box">{grants}</pre>
                  <div className="row">
                    <label className="grow">
                      Database
                      <select value={grantDb} onChange={(e) => setGrantDb(e.target.value)}>
                        <option value="">— pilih database —</option>
                        {databases.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="row">
                    <button disabled={busy || !grantDb} onClick={grantAll}>
                      ✚ Grant ALL
                    </button>
                    <button disabled={busy || !grantDb} onClick={revokeAll}>
                      − Revoke ALL
                    </button>
                  </div>
                  <p className="hint">
                    Untuk privileges per-tabel / kolom, gunakan SQL di editor:
                    <code> GRANT SELECT ON db.tbl TO user</code>
                  </p>
                </>
              )}
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  );
}
