import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore, SavedConnection, SshConfig } from "../store";

const emptyForm = {
  name: "",
  db_type: "mysql",
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "",
  database: "",
  ssl: false,
  save_password: true,
  use_ssh: false,
  ssh: { host: "", port: 22, user: "", password: "", private_key_path: "" } as SshConfig & {
    password: string;
  },
};

export default function ConnectionDialog({
  onClose,
  edit,
}: {
  onClose: () => void;
  edit?: SavedConnection | null;
}) {
  const [form, setForm] = useState(() =>
    edit
      ? {
          ...emptyForm,
          name: edit.name,
          db_type: edit.db_type,
          host: edit.host,
          port: edit.port,
          user: edit.user,
          database: edit.database ?? "",
          ssl: edit.ssl,
          save_password: edit.save_password,
          use_ssh: Boolean(edit.ssh),
          ssh: {
            host: edit.ssh?.host ?? "",
            port: edit.ssh?.port ?? 22,
            user: edit.ssh?.user ?? "",
            password: "",
            private_key_path: edit.ssh?.private_key_path ?? "",
          },
        }
      : emptyForm
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<string | null>(null);
  const [mode, setMode] = useState<"connect" | "save">("connect");

  // mode edit: prefill password (MySQL & SSH) dari keyring agar tidak perlu ketik ulang
  useEffect(() => {
    if (!edit) return;
    (async () => {
      try {
        const pw = await invoke<string | null>("get_saved_password", { id: edit.id });
        if (pw) set("password", pw);
        if (edit.ssh) {
          const spw = await invoke<string | null>("get_saved_ssh_password", { id: edit.id });
          if (spw) setSsh("password", spw);
        }
      } catch {
        // keyring tidak tersedia / tidak ada password — biarkan kosong
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.id]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const setSsh = (k: string, v: any) =>
    setForm((f) => ({ ...f, ssh: { ...f.ssh, [k]: v } }));

  const testOnly = async () => {
    setBusy(true);
    setError(null);
    try {
      await useStore.getState().connectAdhoc(
        {
          db_type: form.db_type,
          host: form.host,
          port: form.port,
          user: form.user,
          password: form.password,
          database: form.database || null,
          ssl: form.ssl,
          ssh: form.use_ssh ? sshFromForm() : null,
        },
        form.name || `${form.host}:${form.port}`
      );
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveAndConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved: SavedConnection = {
        id: edit?.id ?? crypto.randomUUID(),
        name: form.name || `${form.host}:${form.port}`,
        db_type: form.db_type,
        host: form.host,
        port: form.port,
        user: form.user,
        database: form.database || null,
        ssl: form.ssl,
        save_password: form.save_password,
        ssh: form.use_ssh
          ? {
              host: form.ssh.host,
              port: form.ssh.port,
              user: form.ssh.user,
              password: form.ssh.password || null,
              private_key_path: form.ssh.private_key_path || null,
            }
          : null,
      };
      await useStore.getState().saveConn(
        saved,
        // saat edit dengan password kosong: jangan overwrite password lama di keyring
        form.save_password && form.password !== "" ? form.password : undefined
      );
      // password SSH disimpan ke keyring terpisah (kompatibel dgn hasil import)
      if (form.use_ssh && form.ssh.password) {
        await invoke("store_ssh_password", { id: saved.id, password: form.ssh.password }).catch(() => {});
      }
      await useStore.getState().connectSaved(saved.id);
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickKey = async () => {
    const file = await open({ multiple: false, title: "Pilih private key SSH" });
    if (file) setSsh("private_key_path", file as string);
  };

  // SSH params untuk test/connect ad-hoc (bukan tersimpan)
  const sshFromForm = () => ({
    host: form.ssh.host,
    port: form.ssh.port,
    user: form.ssh.user,
    password: form.ssh.password || null,
    private_key_path: form.ssh.private_key_path || null,
  });

  const testConn = async () => {
    setBusy(true);
    setError(null);
    setTestOk(null);
    try {
      const version = await invoke<string>("test_connection", {
        params: {
          db_type: form.db_type,
          host: form.host,
          port: form.port,
          user: form.user,
          password: form.password,
          database: form.database || null,
          ssl: form.ssl,
          ssh: form.use_ssh ? sshFromForm() : null,
        },
      });
      setTestOk(`✔ ${version}`);
    } catch (e: any) {
      setTestOk(null);
      setError(`Test koneksi gagal: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>{edit ? `Edit Connection — ${edit.name}` : "New Connection"}</h2>
        <label>
          Nama koneksi
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="mis. Localhost Dev"
          />
        </label>
        <label>
          Database type
          <select
            value={form.db_type}
            onChange={(e) => {
              set("db_type", e.target.value);
              set("port", e.target.value === "mysql" ? 3306 : 5432);
            }}
          >
            <option value="mysql">MySQL / MariaDB</option>
            <option value="postgres">PostgreSQL</option>
          </select>
        </label>
        <div className="row">
          <label className="grow">
            Host
            <input value={form.host} onChange={(e) => set("host", e.target.value)} />
          </label>
          <label className="small">
            Port
            <input
              type="number"
              value={form.port}
              onChange={(e) => set("port", Number(e.target.value))}
            />
          </label>
        </div>
        <div className="row">
          <label className="grow">
            User
            <input value={form.user} onChange={(e) => set("user", e.target.value)} />
          </label>
          <label className="grow">
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </label>
        </div>
        <label>
          Database (opsional)
          <input value={form.database} onChange={(e) => set("database", e.target.value)} />
        </label>
        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={form.ssl}
              onChange={(e) => set("ssl", e.target.checked)}
            />
            SSL/TLS
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.save_password}
              onChange={(e) => set("save_password", e.target.checked)}
            />
            Simpan password (Windows Credential Manager)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.use_ssh}
              onChange={(e) => set("use_ssh", e.target.checked)}
            />
            Gunakan SSH tunnel
          </label>
        </div>

        {form.use_ssh && (
          <div className="ssh-box">
            <h3>SSH</h3>
            <div className="row">
              <label className="grow">
                SSH Host
                <input value={form.ssh.host} onChange={(e) => setSsh("host", e.target.value)} />
              </label>
              <label className="small">
                Port
                <input
                  type="number"
                  value={form.ssh.port}
                  onChange={(e) => setSsh("port", Number(e.target.value))}
                />
              </label>
            </div>
            <div className="row">
              <label className="grow">
                SSH User
                <input value={form.ssh.user} onChange={(e) => setSsh("user", e.target.value)} />
              </label>
              <label className="grow">
                SSH Password (opsional utk key)
                <input
                  type="password"
                  value={form.ssh.password}
                  onChange={(e) => setSsh("password", e.target.value)}
                />
              </label>
            </div>
            <div className="row">
              <label className="grow">
                Private key (opsional)
                <input
                  value={form.ssh.private_key_path ?? ""}
                  onChange={(e) => setSsh("private_key_path", e.target.value)}
                  placeholder="C:\Users\you\.ssh\id_rsa"
                />
              </label>
              <button onClick={pickKey}>Browse…</button>
            </div>
            <p className="hint">
              Host/port di atas = tujuan setelah tunnel (mis. 127.0.0.1:3306 di server SSH).
            </p>
          </div>
        )}

        {error && <div className="error">{error}</div>}
        {testOk && <div className="ok">{testOk}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button disabled={busy} onClick={testConn}>
            {busy ? "Menguji..." : "Test Koneksi"}
          </button>
          <button disabled={busy} onClick={testOnly}>
            {busy && mode === "connect" ? "Connecting..." : "Connect saja"}
          </button>
          <button className="primary" disabled={busy} onClick={saveAndConnect}>
            {edit ? "Simpan Perubahan & Connect" : "Simpan & Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
