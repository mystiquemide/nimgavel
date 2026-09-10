// Reconnecting WebSocket client for auction rooms with server clock offset.
// Countdowns render locally from endsAt + offset: no per-second traffic.
const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 1_000;

export function createRoomSocket({ lotId, getPaddleToken = () => null, onMessage, onStatus }) {
  let socket = null;
  let closedByApp = false;
  let attempts = 0;
  let reconnectTimer = null;
  let lastOffset = 0;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${location.host}/ws/${encodeURIComponent(lotId)}`;

  const status = (state) => { if (onStatus) onStatus(state, attempts); };

  function connect() {
    if (closedByApp) return;
    status(attempts === 0 ? "connecting" : "reconnecting");
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      attempts = 0;
      const paddleToken = getPaddleToken();
      if (paddleToken) socket.send(JSON.stringify({ type: "join", paddleToken }));
      status(paddleToken ? "authenticating" : "open");
    });

    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message && typeof message.serverNow === "number") {
        lastOffset = message.serverNow - Date.now();
      }
      if (message?.type === "joined") status("open");
      if (message?.code === "invalid_token") status("unauthorized");
      onMessage(message);
    });

    socket.addEventListener("close", () => {
      socket = null;
      if (closedByApp) { status("closed"); return; }
      scheduleReconnect();
    });

    socket.addEventListener("error", () => { /* close handler drives reconnect */ });
  }

  function scheduleReconnect() {
    if (closedByApp || reconnectTimer !== null) return;
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
    attempts += 1;
    status("reconnecting");
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, backoff);
  }

  return {
    connect,
    authenticate() {
      const paddleToken = getPaddleToken();
      if (paddleToken && socket?.readyState === WebSocket.OPEN) {
        status("authenticating");
        socket.send(JSON.stringify({ type: "join", paddleToken }));
      }
    },
    close() {
      closedByApp = true;
      if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (socket) socket.close();
      status("closed");
    },
    send(message) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return true;
      }
      return false;
    },
    get connected() { return Boolean(socket && socket.readyState === WebSocket.OPEN); },
    get clockOffset() { return lastOffset; }
  };
}
