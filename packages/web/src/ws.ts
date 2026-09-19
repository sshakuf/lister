export type WsMessage = { type: "file.changed"; path: string };

/** Connects to /ws and calls `onMessage`; reconnects with backoff. Returns a disposer. */
export function connectWs(onMessage: (m: WsMessage) => void, onStatus?: (open: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: number | null = null;

  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      attempt = 0;
      onStatus?.(true);
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as WsMessage;
        if (m && m.type === "file.changed") onMessage(m);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      onStatus?.(false);
      if (closed) return;
      const delay = Math.min(30_000, 500 * 2 ** attempt++);
      timer = window.setTimeout(open, delay);
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
