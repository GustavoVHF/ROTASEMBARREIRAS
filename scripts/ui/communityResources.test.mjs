// Testes dos helpers de recursos relatados pela comunidade (node:test).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNITY_RESOURCES,
  toggleRecurso,
  recursosResumo,
  consensoResumo,
} from "../../src/lib/communityResources.ts";

test("todo recurso tem rótulo curto", () => {
  assert.equal(COMMUNITY_RESOURCES.length, 5);
  for (const r of COMMUNITY_RESOURCES) assert.ok(r.short.length > 0);
});

test("toggleRecurso liga, desliga e não muta a entrada", () => {
  const empty = {};
  const on = toggleRecurso(empty, "banheiro");
  assert.deepEqual(on, { banheiro: "tem" });
  assert.deepEqual(empty, {});
  const off = toggleRecurso(on, "banheiro");
  assert.deepEqual(off, {});
  assert.deepEqual(on, { banheiro: "tem" });
});

test("toggleRecurso: nao_tem antigo vira tem", () => {
  assert.deepEqual(toggleRecurso({ entrada: "nao_tem" }, "entrada"), { entrada: "tem" });
});

test("recursosResumo", () => {
  assert.equal(recursosResumo({}), null);
  assert.equal(recursosResumo(null), null);
  assert.equal(recursosResumo({ banheiro: "tem", libras: "tem" }), "Tem: Banheiro adaptado, Atendimento em Libras");
  assert.equal(
    recursosResumo({ banheiro: "tem", entrada: "nao_tem" }),
    "Tem: Banheiro adaptado · Não tem: Entrada sem degraus ou com rampa"
  );
});

test("consensoResumo com singular, plural e não tem", () => {
  assert.equal(consensoResumo([]), null);
  assert.equal(
    consensoResumo([
      { recurso: "banheiro", estado: "tem", apoiadores: 3, total: 3 },
      { recurso: "entrada", estado: "nao_tem", apoiadores: 4, total: 5 },
    ]),
    "Relatado pela comunidade: Banheiro adaptado (3 pessoas) · Entrada sem degraus ou com rampa: não tem (4 pessoas)"
  );
  assert.equal(
    consensoResumo([{ recurso: "libras", estado: "tem", apoiadores: 1, total: 1 }]),
    "Relatado pela comunidade: Atendimento em Libras (1 pessoa)"
  );
});
