import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";

interface SycsEntry {
  name: string;
  host: string;
  port: number;
  user: string;
  ssh: boolean;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
}

/** Dialog Import/Export koneksi — kompatibel file .sycs SQLyog, checklist per koneksi. */
export default function ConnTransfer({ mode, onClose }: { mode: "import" | "export"; onClose: () => void }) {
  const savedList = useStore((s) => s.savedList);
  const loadSaved = useStore((s) => s.loadSaved);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<SycsEntry[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickFile = async () => {
    const sel = await open({
      filters: [{ name: "Koneksi SQLyog", extensions: ["sycs", "ini"] }],
    });
    if (!sel || typeof sel !== "string") return;
    setPath(sel);
    try {
      const list = await invoke<SycsEntry[]>("sycs_parse", { path: sel });
      setEntries(list);
      setChecked(new Set(list.map((_, i) => i)));
      setErr(null);
    } catch (e: any) {
      setEntries(null);
      setErr(String(e));
    }
  };

  const toggle = (i: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const toggleAll = () =>
    setChecked((s) => (s.size === entries?.length ? new Set() : new Set(entries?.map((_, i) => i))));

  const doImport = async () => {
    setBusy(true);
    setErr(null);
    try {
      const n = await invoke<number>("sycs_import", { path, indexes: [...checked] });
      await loadSaved();
      setMsg(`✔ ${n} koneksi berhasil diimport`);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickExport = async () => {
    const target = await save({
      defaultPath: "koneksi_opensyog.sycs",
      filters: [{ name: "Koneksi SQLyog/OpenSyog", extensions: ["sycs"] }],
    });
    if (!target) return;
    setBusy(true);
    setErr(null);
    try {
      const ids = savedList.filter((c) => checkedIds.has(c.id)).map((c) => c.id);
      const n = await invoke<number>("sycs_export", { ids, path: target });
      setMsg(`✔ ${n} koneksi diexport ke ${target}`);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleSaved = (id: string) =>
    setCheckedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allSavedChecked = savedList.length > 0 && checkedIds.size === savedList.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal conn-transfer" onClick={(e) => e.stopPropagation()}>
        <h2>{mode === "import" ? "Import Koneksi dari SQLyog (.sycs)" : "Export Koneksi ke file .sycs"}</h2>

        {mode === "import" ? (
          <>
            <div className="row">
              <button className="primary" onClick={pickFile}>Pilih file .sycs…</button>
              <span className="muted ellipsis">{path}</span>
            </div>
            {entries && entries.length > 0 && (
              <>
                <div className="row ct-head">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={checked.size === entries.length}
                      onChange={toggleAll}
                    />
                    Pilih semua ({entries.length})
                  </label>
                </div>
                <div className="ct-list">
                  {entries.map((e, i) => (
                    <label key={i} className="check ct-item">
                      <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                      <span className="ct-name">{e.name}</span>
                      <span className="muted">{e.user}@{e.host}:{e.port}{e.ssh ? ` · SSH ${e.ssh_user}@${e.ssh_host}` : ""}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            {entries && entries.length === 0 && <div className="muted">Tidak ada koneksi di file ini.</div>}
          </>
        ) : (
          <>
            <div className="row ct-head">
              <label className="check">
                <input
                  type="checkbox"
                  checked={allSavedChecked}
                  onChange={() => setCheckedIds(allSavedChecked ? new Set() : new Set(savedList.map((c) => c.id)))}
                />
                Pilih semua ({savedList.length})
              </label>
            </div>
            <div className="ct-list">
              {savedList.length === 0 && <div className="muted">Belum ada koneksi tersimpan.</div>}
              {savedList.map((c) => (
                <label key={c.id} className="check ct-item">
                  <input
                    type="checkbox"
                    checked={checkedIds.has(c.id)}
                    onChange={() => toggleSaved(c.id)}
                  />
                  <span className="ct-name">{c.name}</span>
                  <span className="muted">{c.user}@{c.host}:{c.port}{c.ssh ? ` · SSH ${c.ssh.user}@${c.ssh.host}` : ""}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {err && <div className="error">{err}</div>}
        {msg && <div className="ok-box">{msg}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>Tutup</button>
          {mode === "import" ? (
            <button className="primary" disabled={busy || checked.size === 0 || !path} onClick={doImport}>
              {busy ? "Mengimport…" : `Import ${checked.size} koneksi`}
            </button>
          ) : (
            <button className="primary" disabled={busy || checkedIds.size === 0} onClick={pickExport}>
              {busy ? "Mengexport…" : `Export ${checkedIds.size} koneksi…`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
