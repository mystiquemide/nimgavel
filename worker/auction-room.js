// AuctionRoom Durable Object: authoritative state machine for one lot.
// Implemented in T3.
export class AuctionRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    return Response.json({ error: "not implemented" }, { status: 501 });
  }
}
