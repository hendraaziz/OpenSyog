import { useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { useStore } from "../store";
import TableDesigner from "./TableDesigner";
import SchemaDesigner from "./SchemaDesigner";

const language = new Compartment();
const theme = new Compartment();

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "JOIN",
  "LEFT", "RIGHT", "INNER", "OUTER", "GROUP", "ORDER", "BY", "LIMIT", "OFFSET",
  "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "INDEX", "VALUES", "INTO", "SET",
  "AND", "OR", "NOT", "NULL", "IS", "AS", "ON", "DISTINCT", "HAVING", "UNION",
  "EXISTS", "COUNT", "SUM", "AVG", "MIN", "MAX", "LIKE", "IN", "BETWEEN",
  "TRUNCATE", "RENAME", "TO", "ADD", "COLUMN", "PRIMARY", "KEY", "FOREIGN",
  "REFERENCES", "CONSTRAINT", "CASCADE", "IF", "DESC", "ASC",
];

/** Ambil map alias → nama tabel dari teks SQL (FROM/JOIN/UPDATE/INTO x [AS] a). */
function getAliasMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+((?:`[^`]+`\s*\.\s*)*(?:`[^`]+`|[\w$]+))(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1].replace(/`/g, "");
    const table = raw.split(".").pop() ?? raw;
    if (m[2]) map.set(m[2].toLowerCase(), table);
  }
  return map;
}

export default function SqlEditor() {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeTabId = useStore((s) => s.activeQueryTabId);
  const tab = useStore((s) => s.queryTabs.find((t) => t.id === s.activeQueryTabId));
  const tabs = useStore((s) => s.queryTabs);

  // (re)create editor saat ganti tab aktif (skip tab designer — editor tidak dirender)
  useEffect(() => {
    if (!ref.current || !tab || tab.kind) return;
    if (viewRef.current) viewRef.current.destroy();

    const view = new EditorView({
      parent: ref.current,
      state: EditorState.create({
        doc: tab.text,
        extensions: [
          language.of(sql()),
          theme.of([]),
          history(),
          autocompletion({
            icons: false,
            override: [
              (ctx) => {
                const before = ctx.state.doc.sliceString(0, ctx.pos);
                const chainMatch = before.match(/[A-Za-z0-9_$.`"]*$/);
                const chain = chainMatch ? chainMatch[0] : "";
                if (!chain && !ctx.explicit) return null;

                // baca state terbaru (schema bisa datang setelah editor dibuat)
                const st = useStore.getState();
                const conn = st.connections.find((c) => c.id === tab.connId);
                const schema = conn?.schema ?? null;
                const schemaFind = (t: string) =>
                  schema?.find((s) => s.table.toLowerCase() === t.toLowerCase());
                const schemaTables = schema
                  ? schema.map((s) => s.table)
                  : conn?.objects?.tables ?? [];

                const strip = (s: string) => s.replace(/[`"]/g, "");
                const parts = chain.split(".");
                const lastSeg = parts[parts.length - 1] ?? "";
                const from = ctx.pos - lastSeg.length;
                const docText = ctx.state.doc.toString();
                const aliasMap = getAliasMap(docText);

                const mk = (label: string, type: string, apply?: string) => ({
                  label,
                  type,
                  apply: apply ?? label,
                });

                // ===== hierarkis: ada titik (db. / tabel. / alias. / db.tabel.) =====
                if (parts.length > 1 || chain.endsWith(".")) {
                  const refs = parts.slice(0, -1).map(strip).filter(Boolean);
                  let columns: string[] = [];
                  let tables: string[] = [];

                  if (refs.length === 1) {
                    const r = refs[0].toLowerCase();
                    if (aliasMap.has(r)) {
                      const t = aliasMap.get(r)!;
                      columns = schemaFind(t)?.columns.map((c) => c.name) ?? [];
                    } else if (
                      conn?.databases.some((d) => d.toLowerCase() === r) ||
                      conn?.activeDatabase?.toLowerCase() === r
                    ) {
                      tables = schemaTables;
                    } else {
                      const ts = schemaFind(refs[0]);
                      if (ts) columns = ts.columns.map((c) => c.name);
                      else tables = schemaTables;
                    }
                  } else if (refs.length >= 2) {
                    const [d, t] = refs;
                    if (aliasMap.has(d.toLowerCase())) {
                      const at = aliasMap.get(d.toLowerCase())!;
                      columns = schemaFind(at)?.columns.map((c) => c.name) ?? [];
                    } else {
                      const ts = schemaFind(t);
                      if (ts) columns = ts.columns.map((c) => c.name);
                    }
                  }

                  const options = [
                    ...columns.map((c) => mk(c, "property")),
                    ...tables.map((t) => mk(t, "table", t + ".")),
                  ];
                  if (columns.length > 0) options.push(mk("*", "keyword"));
                  if (options.length === 0) return null;
                  return { from, options, validFor: /^[\w`]*$/ };
                }

                // ===== tanpa titik: keyword + database + tabel + alias =====
                const options = [
                  ...SQL_KEYWORDS.map((k) => mk(k, "keyword", k + " ")),
                  ...(conn?.databases ?? []).map((d) => mk(d, "database", d + ".")),
                  ...schemaTables.map((t) => mk(t, "table")),
                  ...[...aliasMap.keys()].map((a) => mk(a, "variable", a + ".")),
                ];
                return { from, options, validFor: /^[\w`]*$/ };
              },
            ],
          }),
          keymap.of([
            {
              key: "F9",
              run: () => {
                useStore.getState().runQuery(tab.id);
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              useStore.getState().setQueryText(tab.id, u.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [activeTabId, tab?.connId]);

  return (
    <div className="sql-editor">
      <div className="editor-tabs">
        {tabs.map((t) => (
          <span
            key={t.id}
            className={"tab" + (t.id === activeTabId ? " active" : "") + (t.kind ? " designer" : "")}
            onClick={() => useStore.getState().setActiveQueryTab(t.id)}
          >
            {t.kind === "schema-designer" ? "⬚ " : t.kind ? "✎ " : ""}{t.title}
            <button
              className="chip-x"
              onClick={(e) => {
                e.stopPropagation();
                useStore.getState().closeQueryTab(t.id);
              }}
            >
              ×
            </button>
          </span>
        ))}
        {tab && tab.connId && (
          <button
            className="tab-add"
            onClick={() => useStore.getState().newQueryTab(tab.connId)}
            title="Ctrl+T"
          >
            +
          </button>
        )}
      </div>
      {tab?.kind ? (
        tab.kind === "schema-designer" ? (
          <SchemaDesigner
            connId={tab.connId}
            database={tab.designerDb!}
            onClose={() => useStore.getState().closeQueryTab(tab.id)}
          />
        ) : (
          <TableDesigner
            connId={tab.connId}
            database={tab.designerDb!}
            editTable={tab.designerTable}
            onClose={() => useStore.getState().closeQueryTab(tab.id)}
          />
        )
      ) : (
        <div ref={ref} className="editor-body" />
      )}
    </div>
  );
}
