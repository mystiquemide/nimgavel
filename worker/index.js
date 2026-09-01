// Nimgavel worker: REST router + WS forwarding to AuctionRoom Durable Objects.
import { AuctionRoom } from "./auction-room.js";

export { AuctionRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, app: "nimgavel", ts: Date.now() });
    }

    if (url.pathname.startsWith("/ws/")) {
      const lotId = url.pathname.split("/")[2];
      if (!lotId) return Response.json({ error: "lot id required" }, { status: 400 });
      const stub = env.ROOM.get(env.ROOM.idFromName(lotId));
      return stub.fetch(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not implemented" }, { status: 501 });
    }

    return new Response("not found", { status: 404 });
  },
};
