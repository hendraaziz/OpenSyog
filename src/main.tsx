import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useStore, initSessionPersistence, readSession } from "./store";
import "./styles.css";

initSessionPersistence();

// restore tab query dari sesi sebelumnya (tetap ada walau close paksa)
const prevSession = readSession();
if (prevSession && prevSession.tabs.length > 0) {
  const tabCounter = { n: 0 };
  useStore.setState({
    queryTabs: prevSession.tabs.map((t) => ({
      id: crypto.randomUUID(),
      // koneksi akan direconnect manual oleh user; null utk sementara
      connId: "",
      title: t.title,
      text: t.text,
      result: null,
      connName: t.connName,
    })) as any,
    activeQueryTabId: null,
    bottomTab: (["query", "table", "history"].includes(prevSession.bottomTab)
      ? prevSession.bottomTab
      : "query") as any,
  });
  void tabCounter;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "monospace", color: "#b00" }}>
          <h2>Terjadi error di aplikasi</h2>
          <pre>{String(this.state.error?.stack ?? this.state.error)}</pre>
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
