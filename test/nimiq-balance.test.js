import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BalanceLookupError,
  fetchNimBalance,
  parseNimBalancePayload
} from "../worker/nimiq-balance.js";

const ADDRESS = "NQ49 A9A5 9UFL SDTQ 8HPU 5U43 1V4T EYMS EPT0";
const RPC = "https://rpc.example.invalid";

function rpcResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("parses canonical PoS result.data balance", () => {
  const balance = parseNimBalancePayload({
    jsonrpc: "2.0",
    result: {
      data: {
        address: ADDRESS,
        balance: 62294498429,
        type: "basic"
      }
    },
    id: 1
  });
  assert.equal(balance, 62294498429);
});

test("keeps compatibility with a direct result balance string", () => {
  const balance = parseNimBalancePayload({
    jsonrpc: "2.0",
    result: { balance: "300000" },
    id: 1
  });
  assert.equal(balance, 300000);
});

test("never coerces a null balance to zero", () => {
  assert.throws(
    () => parseNimBalancePayload({ result: { data: { balance: null } } }),
    (error) => error instanceof BalanceLookupError && error.code === "invalid_payload"
  );
});

test("rejects missing, negative, fractional, boolean and unsafe balances", () => {
  const invalidPayloads = [
    { result: { data: {} } },
    { result: { data: { balance: -1 } } },
    { result: { data: { balance: 1.5 } } },
    { result: { data: { balance: true } } },
    { result: { data: { balance: Number.MAX_SAFE_INTEGER + 1 } } }
  ];

  for (const payload of invalidPayloads) {
    assert.throws(() => parseNimBalancePayload(payload), BalanceLookupError);
  }
});

test("rejects an RPC error instead of treating it as an empty account", () => {
  assert.throws(
    () => parseNimBalancePayload({ error: { code: -32000, message: "busy" }, id: 1 }),
    (error) => error instanceof BalanceLookupError && error.code === "rpc_error"
  );
});

test("confirms an initial zero read before returning zero", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return rpcResponse({ result: { data: { balance: 0 } } });
  };

  const balance = await fetchNimBalance(ADDRESS, RPC, { fetchImpl, retryDelayMs: 0 });
  assert.equal(balance, 0);
  assert.equal(calls, 2);
});

test("a funded retry wins over a stale initial zero", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return rpcResponse({
      result: { data: { balance: calls === 1 ? 0 : 500000 } }
    });
  };

  const balance = await fetchNimBalance(ADDRESS, RPC, { fetchImpl, retryDelayMs: 0 });
  assert.equal(balance, 500000);
  assert.equal(calls, 2);
});

test("retries a transient rate limit and returns the funded balance", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return rpcResponse({ error: "rate limited" }, 429);
    return rpcResponse({ result: { data: { balance: 700000 } } });
  };

  const balance = await fetchNimBalance(ADDRESS, RPC, { fetchImpl, retryDelayMs: 0 });
  assert.equal(balance, 700000);
  assert.equal(calls, 2);
});

test("malformed RPC responses fail closed as unavailable, never zero", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return rpcResponse({ result: { data: { balance: null } } });
  };

  await assert.rejects(
    fetchNimBalance(ADDRESS, RPC, { fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof BalanceLookupError && error.code === "invalid_payload"
  );
  assert.equal(calls, 2);
});
