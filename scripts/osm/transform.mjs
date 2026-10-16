// ============================================================
// Funções puras da sincronização OSM (sem rede, sem banco).
// Testadas em scripts/osm/transform.test.mjs.
// ============================================================

/** Erro com código de saída do CLI (ver scripts/sync-osm.mjs). */
export class SyncError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "SyncError";
    this.exitCode = exitCode;
  }
}

const TIPOS = new Set(["node", "way", "relation"]);

/** Escapa um valor para dentro de aspas duplas do Overpass QL. */
function qlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Escapa metacaracteres de regex (o valor entra em "^(...)$"). */
function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Uma linha nwr[...] por regra. */
function ruleSelector(regra, scope) {
  const chave = qlString(regra.chave);
  if (regra.valores === "*") {
    return `  nwr["${chave}"]["name"]${scope};`;
  }
  const alternativas = regra.valores.map((v) => qlString(regexEscape(v))).join("|");
  return `  nwr["${chave}"~"^(${alternativas})$"]["name"]${scope};`;
}

/**
 * Monta UMA consulta Overpass para a cidade.
 * Com opts.bbox ([sul, oeste, norte, leste]) troca o seletor de área por um
 * bounding box (usado só para gerar a fixture de teste).
 */
export function buildOverpassQuery(cidade, regras, opts = {}) {
  const timeout = Number.isFinite(cidade.timeoutSegundos) ? cidade.timeoutSegundos : 180;
  const linhas = [`[out:json][timeout:${timeout}];`];
  let scope;

  if (opts.bbox) {
    const [s, w, n, e] = opts.bbox.map(Number);
    scope = `(${s},${w},${n},${e})`;
  } else {
    const area = cidade.area;
    let seletor = `area["boundary"="administrative"]["admin_level"="${qlString(area.admin_level)}"]["name"="${qlString(area.name)}"]`;
    for (const [k, v] of Object.entries(area.filtrosExtras ?? {})) {
      seletor += `["${qlString(k)}"="${qlString(v)}"]`;
    }
    linhas.push(`${seletor}->.a;`);
    linhas.push(".a out ids;");
    scope = "(area.a)";
  }

  linhas.push("(");
  for (const regra of regras) {
    linhas.push(ruleSelector(regra, scope));
  }
  linhas.push(");");
  linhas.push("out center;");
  return linhas.join("\n");
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Coordenada: lat/lon em nodes; center (centróide) em ways/relations. */
export function elementCoords(el) {
  if (el.type === "node") {
    return isFiniteNumber(el.lat) && isFiniteNumber(el.lon) ? { lat: el.lat, lng: el.lon } : null;
  }
  const c = el.center;
  return c && isFiniteNumber(c.lat) && isFiniteNumber(c.lon) ? { lat: c.lat, lng: c.lon } : null;
}

function ruleMatches(regra, tags) {
  const valor = tags[regra.chave];
  if (valor === undefined || valor === null || valor === "") return false;
  if (regra.valores === "*") return true;
  return regra.valores.includes(valor);
}

/**
 * Classifica um elemento pela PRIMEIRA regra que casar.
 * Devolve { ok: true, categoria, lat, lng } ou { ok: false, motivo }.
 * motivo ∈ "sem_nome" | "sem_regra" | "sem_coordenadas".
 */
export function classifyElement(el, regras) {
  const tags = el.tags ?? {};
  const nome = typeof tags.name === "string" ? tags.name.trim() : "";
  if (!nome) return { ok: false, motivo: "sem_nome" };

  const regra = regras.find((r) => ruleMatches(r, tags));
  if (!regra) return { ok: false, motivo: "sem_regra" };

  const coords = elementCoords(el);
  if (!coords) return { ok: false, motivo: "sem_coordenadas" };

  return { ok: true, categoria: regra.categoria, lat: coords.lat, lng: coords.lng };
}

/**
 * Processa a resposta inteira da Overpass: confere a área (exatamente uma),
 * descarta os elementos "area", classifica o resto e conta os descartes.
 * Lança SyncError(exit 4) nos casos fatais do design §4.3.
 */
export function processResponse(json, regras, opts = {}) {
  const elementos = Array.isArray(json?.elements) ? json.elements : [];
  const areas = elementos.filter((e) => e.type === "area");

  if (!opts.semArea) {
    if (areas.length === 0) {
      throw new SyncError("A área da cidade não foi encontrada no OSM (0 relações); verifique CIDADES em scripts/osm/config.mjs.", 4);
    }
    if (areas.length > 1) {
      throw new SyncError(`A área casou com ${areas.length} relações; adicione filtrosExtras em scripts/osm/config.mjs.`, 4);
    }
  }

  const contagens = { sem_nome: 0, sem_regra: 0, sem_coordenadas: 0, sem_coordenadas_node: 0 };
  const validos = [];

  for (const el of elementos) {
    if (el.type === "area" || !TIPOS.has(el.type)) continue;
    const r = classifyElement(el, regras);
    if (!r.ok) {
      contagens[r.motivo] += 1;
      if (r.motivo === "sem_coordenadas" && el.type === "node") contagens.sem_coordenadas_node += 1;
      continue;
    }
    validos.push(toPayload(el, r));
  }

  if (contagens.sem_coordenadas_node > 0) {
    throw new SyncError(
      `A resposta não trouxe coordenadas para ${contagens.sem_coordenadas_node} nodes; confira a verbosidade "out center;" em scripts/osm/transform.mjs.`,
      4
    );
  }
  if (validos.length === 0) {
    throw new SyncError("Nenhum elemento: verifique a área.", 4);
  }

  return { elementos: sortByPriority(validos), contagens, areas: areas.length };
}

/** addr:street + ", " + addr:housenumber + " - " + addr:suburb. Sem rua -> null. */
export function buildEndereco(tags = {}) {
  const rua = typeof tags["addr:street"] === "string" ? tags["addr:street"].trim() : "";
  if (!rua) return null;
  let s = rua;
  const numero = typeof tags["addr:housenumber"] === "string" ? tags["addr:housenumber"].trim() : "";
  if (numero) s += `, ${numero}`;
  const bairro = typeof tags["addr:suburb"] === "string" ? tags["addr:suburb"].trim() : "";
  if (bairro) s += ` - ${bairro}`;
  return s.length > 255 ? null : s;
}

/** Só http(s)://, senão null (impede javascript: e afins). */
export function sanitizeWebsite(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 255) return null;
  return /^https?:\/\//i.test(s) ? s : null;
}

/** Mantém só [0-9+()\- ]; null se não sobrar dígito. */
export function sanitizePhone(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[^0-9+() -]/g, "").trim();
  if (!/[0-9]/.test(s)) return null;
  return s.slice(0, 255);
}

function shortText(raw, max) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s ? s.slice(0, max) : null;
}

/** Formato do elemento enviado à RPC (design §4.4). "ordem" é definido em sortByPriority. */
export function toPayload(el, classificado) {
  const tags = el.tags ?? {};
  return {
    ordem: 0,
    osm_tipo: el.type,
    osm_id: el.id,
    nome: String(tags.name).trim(),
    categoria: classificado.categoria,
    lat: classificado.lat,
    lng: classificado.lng,
    endereco: buildEndereco(tags),
    wheelchair: shortText(tags.wheelchair, 32),
    toilets_wheelchair: shortText(tags["toilets:wheelchair"], 32),
    opening_hours: shortText(tags.opening_hours, 255),
    phone: sanitizePhone(tags.phone ?? tags["contact:phone"]),
    website: sanitizeWebsite(tags.website ?? tags["contact:website"]),
  };
}

const TIPO_ORDEM = { node: 0, way: 1, relation: 2 };

function usefulTagCount(p) {
  return ["wheelchair", "toilets_wheelchair", "opening_hours", "phone", "website", "endereco"].filter(
    (k) => p[k] !== null && p[k] !== undefined
  ).length;
}

/**
 * Ordem de prioridade: node < way < relation; no mesmo tipo, mais tags úteis
 * primeiro; desempate por osm_id crescente. Grava "ordem" = índice
 * (o node com mais tags vira o elemento primário do ponto).
 */
export function sortByPriority(payloads) {
  const ordenados = [...payloads].sort((a, b) => {
    const t = TIPO_ORDEM[a.osm_tipo] - TIPO_ORDEM[b.osm_tipo];
    if (t !== 0) return t;
    const u = usefulTagCount(b) - usefulTagCount(a);
    if (u !== 0) return u;
    return a.osm_id - b.osm_id;
  });
  return ordenados.map((p, i) => ({ ...p, ordem: i }));
}
