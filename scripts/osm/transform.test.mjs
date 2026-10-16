// Testes unitários das funções puras da sincronização OSM (node:test).
//
// A fixture scripts/osm/fixtures/overpass-gv-amostra.json contém dados do
// OpenStreetMap: © OpenStreetMap contributors, disponíveis sob a Open
// Database License (ODbL) — https://www.openstreetmap.org/copyright

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CIDADES, REGRAS } from "./config.mjs";
import {
  buildOverpassQuery,
  classifyElement,
  processResponse,
  sortByPriority,
  toPayload,
  buildEndereco,
  sanitizeWebsite,
  sanitizePhone,
  SyncError,
} from "./transform.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "overpass-gv-amostra.json");
const GV = CIDADES["governador-valadares"];
const AREA = { type: "area", id: 3600000001 };

function node(id, tags, lat = -18.85, lon = -41.94) {
  return { type: "node", id, lat, lon, tags };
}

test("query: uma consulta, área com filtrosExtras, .a out ids, [\"name\"] e out center;", () => {
  const q = buildOverpassQuery(GV, REGRAS);
  assert.match(q, /^\[out:json\]\[timeout:180\];/);
  assert.match(
    q,
    /area\["boundary"="administrative"\]\["admin_level"="8"\]\["name"="Governador Valadares"\]\["IBGE:GEOCODIGO"="3127701"\]->\.a;/
  );
  assert.match(q, /\n\.a out ids;\n/);
  assert.ok(q.trimEnd().endsWith("out center;"));
  assert.equal((q.match(/out center;/g) ?? []).length, 1);
  const linhas = q.split("\n").filter((l) => l.trim().startsWith("nwr["));
  assert.equal(linhas.length, REGRAS.length);
  for (const l of linhas) {
    assert.ok(l.includes('["name"](area.a);'), l);
  }
  assert.ok(q.includes('nwr["tourism"~"^(museum|gallery)$"]["name"](area.a);'));
  assert.ok(q.includes('nwr["historic"]["name"](area.a);'));
  assert.ok(!q.includes("shop"));
});

test("query: escapa aspas no nome da área", () => {
  const q = buildOverpassQuery({ area: { name: 'Cidade "X"', admin_level: "8" } }, REGRAS);
  assert.ok(q.includes('["name"="Cidade \\"X\\""]'));
});

test("classifica pela primeira regra que casar", () => {
  const museuHistorico = classifyElement(node(1, { name: "Museu", tourism: "museum", historic: "building" }), REGRAS);
  assert.equal(museuHistorico.categoria, "Cultura");
  const atracaoHistorica = classifyElement(node(2, { name: "Casa", tourism: "attraction", historic: "house" }), REGRAS);
  assert.equal(atracaoHistorica.categoria, "Patrimônio");
  assert.equal(classifyElement(node(3, { name: "Igreja", amenity: "place_of_worship" }), REGRAS).categoria, "Religião");
  assert.equal(classifyElement(node(4, { name: "Pico", natural: "peak" }), REGRAS).categoria, "Natureza");
  assert.equal(classifyElement(node(5, { name: "Bar", amenity: "restaurant" }), REGRAS).categoria, "Gastronomia");
});

test("shop=* e sem nome são descartados", () => {
  assert.deepEqual(classifyElement(node(1, { name: "Loja", shop: "clothes" }), REGRAS), { ok: false, motivo: "sem_regra" });
  assert.deepEqual(classifyElement(node(2, { amenity: "cafe" }), REGRAS), { ok: false, motivo: "sem_nome" });
});

test("centróide de way/relation vem de center", () => {
  const way = { type: "way", id: 10, center: { lat: -18.86, lon: -41.95 }, nodes: [1, 2, 3], tags: { name: "Parque", leisure: "park" } };
  const r = classifyElement(way, REGRAS);
  assert.equal(r.ok, true);
  assert.equal(r.lat, -18.86);
  assert.equal(r.lng, -41.95);
});

test("node sem lat/lon -> erro de coordenadas (exit 4)", () => {
  const json = { elements: [AREA, { type: "node", id: 1, tags: { name: "Praça", leisure: "park" } }, node(2, { name: "Café", amenity: "cafe" })] };
  assert.throws(
    () => processResponse(json, REGRAS),
    (err) => err instanceof SyncError && err.exitCode === 4 && /coordenadas para 1 nodes/.test(err.message)
  );
});

test("way sem center só é contado em sem_coordenadas", () => {
  const json = {
    elements: [AREA, { type: "way", id: 9, nodes: [1, 2], tags: { name: "Parque", leisure: "park" } }, node(2, { name: "Café", amenity: "cafe" })],
  };
  const r = processResponse(json, REGRAS);
  assert.equal(r.contagens.sem_coordenadas, 1);
  assert.equal(r.contagens.sem_coordenadas_node, 0);
  assert.equal(r.elementos.length, 1);
});

test("0 ou 2 áreas -> erro de área (exit 4); 1 área segue e o elemento area é descartado", () => {
  const el = node(2, { name: "Café", amenity: "cafe" });
  assert.throws(() => processResponse({ elements: [el] }, REGRAS), (e) => e instanceof SyncError && e.exitCode === 4);
  assert.throws(
    () => processResponse({ elements: [AREA, { ...AREA, id: 3600000002 }, el] }, REGRAS),
    (e) => e instanceof SyncError && e.exitCode === 4 && /2 relações/.test(e.message)
  );
  const r = processResponse({ elements: [AREA, el] }, REGRAS);
  assert.equal(r.elementos.length, 1);
  assert.equal(r.elementos[0].osm_tipo, "node");
});

test("nenhum elemento válido -> exit 4", () => {
  assert.throws(
    () => processResponse({ elements: [AREA, node(1, { name: "Loja", shop: "x" })] }, REGRAS),
    (e) => e instanceof SyncError && e.exitCode === 4
  );
});

test("ordenação de prioridade: node < way < relation, mais tags úteis, osm_id", () => {
  const p = (tipo, id, extra = {}) => ({
    osm_tipo: tipo, osm_id: id, nome: "X", categoria: "Lazer", lat: 0, lng: 0,
    endereco: null, wheelchair: null, toilets_wheelchair: null, opening_hours: null, phone: null, website: null, ...extra,
  });
  const out = sortByPriority([
    p("relation", 1),
    p("way", 2, { wheelchair: "yes" }),
    p("node", 30),
    p("node", 40, { wheelchair: "yes", phone: "1" }),
    p("node", 20),
  ]);
  assert.deepEqual(out.map((e) => `${e.osm_tipo}/${e.osm_id}`), ["node/40", "node/20", "node/30", "way/2", "relation/1"]);
  assert.deepEqual(out.map((e) => e.ordem), [0, 1, 2, 3, 4]);
});

test("toPayload: contact:* como fallback, endereço e saneamento", () => {
  const el = node(7, {
    name: " Teatro ",
    amenity: "theatre",
    "contact:phone": "+55 (33) 3333-3333 ramal",
    "contact:website": "https://teatro.exemplo.org",
    "addr:street": "Rua A",
    "addr:housenumber": "10",
    "addr:suburb": "Centro",
    wheelchair: "limited",
  });
  const payload = toPayload(el, classifyElement(el, REGRAS));
  assert.equal(payload.nome, "Teatro");
  assert.equal(payload.phone, "+55 (33) 3333-3333");
  assert.equal(payload.website, "https://teatro.exemplo.org");
  assert.equal(payload.endereco, "Rua A, 10 - Centro");
  assert.equal(payload.wheelchair, "limited");
  assert.equal(payload.toilets_wheelchair, null);
});

test("sanitizeWebsite / sanitizePhone / buildEndereco", () => {
  assert.equal(sanitizeWebsite("javascript:alert(1)"), null);
  assert.equal(sanitizeWebsite("www.exemplo.org"), null);
  assert.equal(sanitizeWebsite("HTTP://exemplo.org"), "HTTP://exemplo.org");
  assert.equal(sanitizePhone("sem telefone"), null);
  assert.equal(sanitizePhone("33 3333-3333"), "33 3333-3333");
  assert.equal(buildEndereco({ "addr:housenumber": "10" }), null);
  assert.equal(buildEndereco({ "addr:street": "Rua B" }), "Rua B");
});

const temFixture = fs.existsSync(FIXTURE);

test(
  "fixture real: todo node tem lat/lon e todo way/relation tem center",
  { skip: temFixture ? false : "fixture ausente (sem rede ao gerar); a guarda sem_coordenadas protege a execução real" },
  () => {
    const json = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    assert.ok(json.elements.length > 0);
    for (const el of json.elements) {
      if (el.type === "node") {
        assert.equal(typeof el.lat, "number", `node ${el.id}`);
        assert.equal(typeof el.lon, "number", `node ${el.id}`);
      } else if (el.type === "way" || el.type === "relation") {
        assert.equal(typeof el.center?.lat, "number", `${el.type} ${el.id}`);
        assert.equal(typeof el.center?.lon, "number", `${el.type} ${el.id}`);
      }
    }
    // A amostra usa bbox no lugar da área (sem elemento "area").
    const r = processResponse(json, REGRAS, { semArea: true });
    assert.ok(r.elementos.length > 0);
    for (const e of r.elementos) {
      assert.ok(["Patrimônio", "Cultura", "Lazer", "Gastronomia", "Natureza", "Religião"].includes(e.categoria));
      assert.ok(Number.isFinite(e.lat) && Number.isFinite(e.lng));
    }
  }
);
