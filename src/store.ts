import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface QueryResult {
  columns: string[];
  rows: any[][];
  rows_affected: number;
  duration_ms: number;
  is_select: boolean;
}

export interface DbObjects {
  tables: string[];
  views: string[];
  procedures: string[];
  functions: string[];
  triggers: string[];
  events: string[];
}

export interface SavedConnection {
  id: string;
  name: string;
  db_type: string;
  host: string;
  port: number;
  user: string;
  database: string | null;
  ssl: boolean;
  save_password: boolean;
  ssh: SshConfig | null;
}

export interface SshConfig {
  host: string;
  port: number;
  user: string;
  password: string | null;
  private_key_path: string | null;
}

export interface ForeignKeyInfo {
  column: string;
  ref_table: string;
  ref_column: string;
}

export interface TableSchema {
  table: string;
  table_comment?: string | null;
  columns: { name: string; data_type: string; nullable: boolean; key: string; default: string | null; comment?: string | null }[];
  foreign_keys: ForeignKeyInfo[];
}

export interface LiveConnInfo {
  id: string;
  savedId: string | null;
  name: string;
  dbType: string;
  version: string;
  databases: string[];
  activeDatabase: string | null;
  objects: DbObjects | null;
  schema: TableSchema[] | null;
}

export interface QueryTab {
  id: string;
  connId: string;
  title: string;
  text: string;
  result: QueryResult | null;
  /** nama koneksi (sesi tersimpan) — dipakai pairing ulang saat reconnect */
  connName?: string | null;
  /** "designer" = tab Manage Table / Schema Designer (tidak disimpan ke sesi) */
  kind?: "query" | "table-designer" | "schema-designer";
  designerDb?: string;
  designerTable?: string | null;
}

/** Tab query tersimpan di sesi (localStorage), dipasangkan ke koneksi lewat nama. */
export interface SessionTab {
  title: string;
  text: string;
  connName: string | null;
}

const SESSION_KEY = "opensyog-session-v1";

export function persistSession() {
  try {
    const s = useStore.getState();
    const nameById = new Map(s.connections.map((c) => [c.id, c.name]));
    const data = {
      tabs: s.queryTabs
        .filter((t) => (t.kind ?? "query") === "query")
        .map((t) => ({
          title: t.title,
          text: t.text,
          connName: nameById.get(t.connId) ?? t.connName ?? null,
        })),
      bottomTab: s.bottomTab,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // localStorage penuh / tidak tersedia — abaikan
  }
}

export function readSession(): { tabs: SessionTab[]; bottomTab: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.tabs)) return null;
    return { tabs: data.tabs, bottomTab: data.bottomTab ?? "query" };
  } catch {
    return null;
  }
}

/** Debounced persist — dipasang sekali di main.tsx. */
let sessionTimer: ReturnType<typeof setTimeout> | null = null;
export function initSessionPersistence() {
  useStore.subscribe((s, prev) => {
    if (
      s.queryTabs !== prev.queryTabs ||
      s.bottomTab !== prev.bottomTab ||
      s.connections !== prev.connections
    ) {
      if (sessionTimer) clearTimeout(sessionTimer);
      sessionTimer = setTimeout(persistSession, 200);
    }
  });
}

export interface TableDataView {
  connId: string;
  database: string;
  table: string;
  limit: number;
  offset: number;
  result: QueryResult | null;
}

interface Store {
  connections: LiveConnInfo[];
  activeConnId: string | null;
  savedList: SavedConnection[];
  queryTabs: QueryTab[];
  activeQueryTabId: string | null;
  selectedTable: string | null;
  tableFilter: string;
  statusMessage: string;
  queryError: string | null;
  tableData: TableDataView | null;
  bottomTab: "query" | "table" | "history" | "info";
  history: string[];

  loadSaved: () => Promise<void>;
  connectAdhoc: (params: any, name: string) => Promise<void>;
  connectSaved: (savedId: string) => Promise<void>;
  closeConn: (connId: string) => Promise<void>;
  setActiveConn: (connId: string) => void;
  selectDatabase: (connId: string, db: string) => Promise<void>;
  refreshConn: (connId: string) => Promise<void>;
  selectTable: (connId: string, table: string) => Promise<void>;
  setTableFilter: (f: string) => void;
  loadTableData: (connId: string, db: string, table: string, offset?: number, limit?: number) => Promise<void>;
  setTableOffset: (offset: number) => Promise<void>;
  setTableLimit: (limit: number) => Promise<void>;
  clearTableData: () => void;
  setBottomTab: (t: "query" | "table" | "history" | "info") => void;
  setStatus: (msg: string) => void;

  newQueryTab: (connId: string) => void;
  openDesignerTab: (connId: string, db: string, table: string | null, kind: "table-designer" | "schema-designer") => void;
  closeQueryTab: (tabId: string) => void;
  setActiveQueryTab: (tabId: string) => void;
  setQueryText: (tabId: string, text: string) => void;
  runQuery: (tabId: string) => Promise<void>;
  saveConn: (conn: SavedConnection, password?: string) => Promise<void>;
  deleteSaved: (id: string) => Promise<void>;
}

let tabCounter = 0;

export const useStore = create<Store>((set, get) => ({
  connections: [],
  activeConnId: null,
  savedList: [],
  queryTabs: [],
  activeQueryTabId: null,
  selectedTable: null,
  tableFilter: "",
  statusMessage: "",
  queryError: null,
  tableData: null,
  bottomTab: "query",
  history: [],

  loadSaved: async () => {
    const list = await invoke<SavedConnection[]>("list_saved_connections");
    set({ savedList: list });
  },

  connectAdhoc: async (params, name) => {
    const id = crypto.randomUUID();
    const version = await invoke<string>("connect", { id, params });
    const conn: LiveConnInfo = {
      id,
      savedId: null,
      name,
      dbType: params.db_type,
      version,
      databases: [],
      activeDatabase: null,
      objects: null,
      schema: null,
    };
    const tabId = crypto.randomUUID();
    // pairing ulang tab sesi yang belum punya koneksi (restore setelah close paksa)
    const restoredTabs = get().queryTabs.filter((t) => !t.connId && t.connName === conn.name);
    set((s) => ({
      connections: [...s.connections, conn],
      activeConnId: id,
      queryTabs:
        restoredTabs.length > 0
          ? s.queryTabs.map((t) => (restoredTabs.some((r) => r.id === t.id) ? { ...t, connId: id } : t))
          : s.queryTabs.length === 0
            ? [{
                id: tabId,
                connId: id,
                title: "Query1",
                text: "-- Tulis SQL di sini, F9 untuk eksekusi\n",
                result: null,
              }]
            : s.queryTabs,
      activeQueryTabId:
        restoredTabs.length > 0
          ? restoredTabs[0].id
          : s.queryTabs.length === 0
            ? tabId
            : s.activeQueryTabId,
    }));
    await get().refreshConn(id);
  },

  connectSaved: async (savedId) => {
    const id = crypto.randomUUID();
    const version = await invoke<string>("connect_saved", { id, savedId });
    const saved = get().savedList.find((c) => c.id === savedId);
    const conn: LiveConnInfo = {
      id,
      savedId,
      name: saved?.name ?? savedId,
      dbType: saved?.db_type ?? "mysql",
      version,
      databases: [],
      activeDatabase: null,
      objects: null,
      schema: null,
    };
    const tabId = crypto.randomUUID();
    // pairing ulang tab sesi yang belum punya koneksi (restore setelah close paksa)
    const restoredTabs = get().queryTabs.filter((t) => !t.connId && t.connName === conn.name);
    set((s) => ({
      connections: [...s.connections, conn],
      activeConnId: id,
      queryTabs:
        restoredTabs.length > 0
          ? s.queryTabs.map((t) => (restoredTabs.some((r) => r.id === t.id) ? { ...t, connId: id } : t))
          : s.queryTabs.length === 0
            ? [{
                id: tabId,
                connId: id,
                title: "Query1",
                text: "-- Tulis SQL di sini, F9 untuk eksekusi\n",
                result: null,
              }]
            : s.queryTabs,
      activeQueryTabId:
        restoredTabs.length > 0
          ? restoredTabs[0].id
          : s.queryTabs.length === 0
            ? tabId
            : s.activeQueryTabId,
    }));
    await get().refreshConn(id);
  },

  closeConn: async (connId) => {
    await invoke("disconnect", { id: connId });
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== connId),
      queryTabs: s.queryTabs.filter((t) => t.connId !== connId),
      activeConnId:
        s.activeConnId === connId
          ? s.connections.find((c) => c.id !== connId)?.id ?? null
          : s.activeConnId,
    }));
  },

  setActiveConn: (connId) => set({ activeConnId: connId }),

  selectDatabase: async (connId, db) => {
    const objects = await invoke<DbObjects>("list_objects", { id: connId, database: db });
    let schema: TableSchema[] | null = null;
    try {
      schema = await invoke<TableSchema[]>("get_schema", { id: connId, database: db });
    } catch {
      schema = null; // schema opsional (DB tanpa akses information_schema)
    }
    set((s) => ({
      connections: s.connections.map((c) =>
        c.id === connId ? { ...c, activeDatabase: db, objects, schema } : c
      ),
      selectedTable: null,
    }));
  },

  refreshConn: async (connId) => {
    const databases = await invoke<string[]>("list_databases", { id: connId });
    set((s) => ({
      connections: s.connections.map((c) =>
        c.id === connId ? { ...c, databases } : c
      ),
    }));
    const conn = get().connections.find((c) => c.id === connId);
    if (conn?.activeDatabase) {
      await get().selectDatabase(connId, conn.activeDatabase);
    }
  },

  selectTable: async (connId, table) => {
    const conn = get().connections.find((c) => c.id === connId);
    const db = conn?.activeDatabase;
    if (!db) return;
    set({ selectedTable: table });
    await get().loadTableData(connId, db, table, 0);
    set({ bottomTab: "table" });
  },

  loadTableData: async (connId, db, table, offset = 0, limit = 1000) => {
    const effLimit = limit === 0 ? 1_000_000_000 : limit; // 0 = tampilkan semua
    const result = await invoke<QueryResult>("select_rows", {
      id: connId,
      database: db,
      table,
      limit: effLimit,
      offset,
    });
    set({
      tableData: { connId, database: db, table, limit, offset, result },
      selectedTable: table,
      statusMessage: result.is_select
        ? `${table}: ${result.rows.length} baris • ${result.duration_ms} ms`
        : "",
    });
  },

  setTableOffset: async (offset) => {
    const td = get().tableData;
    if (!td) return;
    await get().loadTableData(td.connId, td.database, td.table, offset, td.limit);
  },

  setTableLimit: async (limit) => {
    const td = get().tableData;
    if (!td) return;
    await get().loadTableData(td.connId, td.database, td.table, 0, limit);
  },

  clearTableData: () => set({ tableData: null, bottomTab: "query" }),

  setBottomTab: (t) => set({ bottomTab: t }),

  setTableFilter: (f) => set({ tableFilter: f }),

  setStatus: (msg) => set({ statusMessage: msg }),

  newQueryTab: (connId) => {
    tabCounter += 1;
    const tab: QueryTab = {
      id: crypto.randomUUID(),
      connId,
      title: `Query${tabCounter}`,
      text: "-- Tulis SQL di sini, F9 untuk eksekusi\n",
      result: null,
    };
    set((s) => ({ queryTabs: [...s.queryTabs, tab], activeQueryTabId: tab.id }));
  },

  openDesignerTab: (connId, db, table, kind) => {
    const existing = get().queryTabs.find(
      (t) =>
        t.kind === kind &&
        t.connId === connId &&
        t.designerDb === db &&
        (t.designerTable ?? null) === (table ?? null)
    );
    if (existing) {
      set({ activeQueryTabId: existing.id });
      return;
    }
    const base = kind === "schema-designer" ? "Schema Designer" : table ? `Manage: ${table}` : "Create Table";
    const id = crypto.randomUUID();
    const tab: QueryTab = {
      id,
      connId,
      title: base,
      text: "",
      result: null,
      kind,
      designerDb: db,
      designerTable: table,
    };
    set((s) => ({ queryTabs: [...s.queryTabs, tab], activeQueryTabId: id }));
  },

  closeQueryTab: (tabId) =>
    set((s) => {
      const tabs = s.queryTabs.filter((t) => t.id !== tabId);
      return {
        queryTabs: tabs,
        activeQueryTabId:
          s.activeQueryTabId === tabId ? tabs[tabs.length - 1]?.id ?? null : s.activeQueryTabId,
      };
    }),

  setActiveQueryTab: (tabId) => set({ activeQueryTabId: tabId }),

  setQueryText: (tabId, text) =>
    set((s) => ({
      queryTabs: s.queryTabs.map((t) => (t.id === tabId ? { ...t, text } : t)),
    })),

  runQuery: async (tabId) => {
    const tab = get().queryTabs.find((t) => t.id === tabId);
    if (!tab || !tab.text.trim()) return;
    try {
      // buang trailing semicolon/spasi (driver single-statement)
      const sql = tab.text.trim().replace(/;+\s*$/, "");
      const result = await invoke<QueryResult>("execute", { id: tab.connId, sql });
      set((s) => ({
        queryTabs: s.queryTabs.map((t) => (t.id === tabId ? { ...t, result } : t)),
        statusMessage: result.is_select
          ? `${result.rows.length} baris • ${result.duration_ms} ms`
          : `${result.rows_affected} baris terpengaruh • ${result.duration_ms} ms`,
        history: [tab.text.trim(), ...s.history.filter((h) => h !== tab.text.trim())].slice(0, 200),
        // pastikan hasil query langsung terlihat
        bottomTab: "query",
        queryError: null,
      }));
    } catch (e: any) {
      // tampilkan error sebagai pseudo-result agar terlihat di panel Result
      const errResult: QueryResult = {
        columns: [],
        rows: [],
        rows_affected: 0,
        duration_ms: 0,
        is_select: false,
      };
      set((s) => ({
        queryTabs: s.queryTabs.map((t) => (t.id === tabId ? { ...t, result: errResult } : t)),
        statusMessage: `ERROR: ${e}`,
        queryError: String(e),
        bottomTab: "query",
      }));
    }
  },

  saveConn: async (conn, password) => {
    await invoke("save_connection", { conn });
    if (conn.save_password && password !== undefined) {
      await invoke("store_connection_password", { id: conn.id, password });
    }
    await get().loadSaved();
  },

  deleteSaved: async (id) => {
    await invoke("delete_connection", { id });
    await get().loadSaved();
  },
}));
