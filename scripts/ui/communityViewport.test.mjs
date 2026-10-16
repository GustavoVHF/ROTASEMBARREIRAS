// Testes das funções puras de viewport da camada "Em mapeamento" (node:test).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  padBbox,
  clampBbox,
  containsBbox,
  sameQuery,
  MAX_BBOX_SPAN,
  FETCH_PAD,
} from "../../src/components/map/communityViewport.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("padBbox dobra largura e altura em volta do mesmo centro", () => {
  const b = { west: -42, south: -19, east: -41.9, north: -18.8 };
  const p = padBbox(b, 0.5);
  near(p.east - p.west, 2 * (b.east - b.west));
  near(p.north - p.south, 2 * (b.north - b.south));
  near((p.east + p.west) / 2, (b.east + b.west) / 2);
  near((p.north + p.south) / 2, (b.north + b.south) / 2);
});

test("clampBbox mantém o centro e limita o lado", () => {
  const b = { west: -44, south: -20, east: -40, north: -18 };
  const c = clampBbox(b, 1.5);
  near(c.east - c.west, 1.5);
  near(c.north - c.south, 1.5);
  near((c.east + c.west) / 2, -42);
  near((c.north + c.south) / 2, -19);
  const small = { west: -42, south: -19, east: -41.9, north: -18.9 };
  assert.deepEqual(clampBbox(small, 1.5), small);
});

test("containsBbox: dentro, fora e bordas iguais", () => {
  const outer = { west: 0, south: 0, east: 10, north: 10 };
  assert.equal(containsBbox(outer, { west: 1, south: 1, east: 9, north: 9 }), true);
  assert.equal(containsBbox(outer, { ...outer }), true);
  assert.equal(containsBbox(outer, { west: -1, south: 1, east: 9, north: 9 }), false);
  assert.equal(containsBbox(outer, { west: 1, south: 1, east: 9, north: 11 }), false);
});

test("sameQuery compara zoom, categoria e excluído", () => {
  const a = { zoom: 15, category: null, excludeId: null };
  assert.equal(sameQuery(a, { ...a }), true);
  assert.equal(sameQuery(a, { ...a, zoom: 16 }), false);
  assert.equal(sameQuery(a, { ...a, category: "Lazer" }), false);
  assert.equal(sameQuery(a, { ...a, excludeId: "x" }), false);
  assert.equal(sameQuery(null, a), false);
});

test("constantes", () => {
  assert.equal(MAX_BBOX_SPAN, 1.5);
  assert.equal(FETCH_PAD, 0.5);
});
