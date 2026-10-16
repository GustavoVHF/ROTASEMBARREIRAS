// Testes do cliente Overpass com fetch e sleep injetados (sem rede).

import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchOverpass, OverpassError, parseRetryAfter } from "./overpass.mjs";

function resposta(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fakeFetch(respostas) {
  const chamadas = [];
  const impl = async (url, init) => {
    chamadas.push({ url, init });
    const r = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  return { impl, chamadas };
}

function fakeSleep() {
  const esperas = [];
  return { sleep: async (ms) => { esperas.push(ms); }, esperas };
}

const opts = (fetchImpl, sleep) => ({ userAgent: "teste", fetchImpl, sleep, log: () => {} });

test("sucesso direto: um POST com User-Agent e corpo data=", async () => {
  const { impl, chamadas } = fakeFetch([resposta(200, { elements: [] })]);
  const { sleep, esperas } = fakeSleep();
  const json = await fetchOverpass("[out:json];", opts(impl, sleep));
  assert.deepEqual(json, { elements: [] });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].init.method, "POST");
  assert.equal(chamadas[0].init.headers["User-Agent"], "teste");
  assert.ok(chamadas[0].init.body.startsWith("data="));
  assert.equal(esperas.length, 0);
});

test("429 com Retry-After: 2 espera 2 s", async () => {
  const { impl } = fakeFetch([resposta(429, {}, { "retry-after": "2" }), resposta(200, { elements: [1] })]);
  const { sleep, esperas } = fakeSleep();
  const json = await fetchOverpass("q", opts(impl, sleep));
  assert.deepEqual(json, { elements: [1] });
  assert.deepEqual(esperas, [2000]);
});

test("504 -> 30/60/120 s, 3 retentativas e erro", async () => {
  const { impl, chamadas } = fakeFetch([resposta(504, {})]);
  const { sleep, esperas } = fakeSleep();
  await assert.rejects(fetchOverpass("q", opts(impl, sleep)), (e) => e instanceof OverpassError && e.status === "504");
  assert.deepEqual(esperas, [30000, 60000, 120000]);
  assert.equal(chamadas.length, 4);
});

test("remark de timeout é retentado", async () => {
  const { impl, chamadas } = fakeFetch([
    resposta(200, { elements: [], remark: "runtime error: Query timed out in \"query\"" }),
    resposta(200, { elements: [2] }),
  ]);
  const { sleep, esperas } = fakeSleep();
  const json = await fetchOverpass("q", opts(impl, sleep));
  assert.deepEqual(json, { elements: [2] });
  assert.equal(chamadas.length, 2);
  assert.deepEqual(esperas, [30000]);
});

test("400 não é retentado", async () => {
  const { impl, chamadas } = fakeFetch([resposta(400, { erro: "sintaxe" })]);
  const { sleep, esperas } = fakeSleep();
  await assert.rejects(fetchOverpass("q", opts(impl, sleep)), (e) => e instanceof OverpassError && e.status === 400);
  assert.equal(chamadas.length, 1);
  assert.equal(esperas.length, 0);
});

test("erro de rede é retentado", async () => {
  const { impl, chamadas } = fakeFetch([new TypeError("fetch failed"), resposta(200, { elements: [] })]);
  const { sleep } = fakeSleep();
  await fetchOverpass("q", opts(impl, sleep));
  assert.equal(chamadas.length, 2);
});

test("Retry-After limitado a 300 s e em data HTTP", () => {
  assert.equal(parseRetryAfter("9999"), 300);
  assert.equal(parseRetryAfter(null), null);
  const agora = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", agora), 10);
});
