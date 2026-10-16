/**
 * Diagnóstico SOMENTE LEITURA da RPC pontos_comunidade_bbox (camada
 * "Em mapeamento" do mapa). Usa só a chave anon (pública) — nunca a
 * service_role — e não imprime chaves.
 *
 * Para Governador Valadares, tela de celular 390×844, zooms 13/15/16:
 * pede a área A e a área B (A deslocada 15 % para leste) e compara as linhas
 * cujo ponto/centro cai em A∩B. Com a grade estável (migração 04) não deve
 * haver diferença; antes dela, grupos cortados pela borda mudam de chave,
 * contagem ou posição (= marcadores piscando ao arrastar).
 *
 * Uso: npm run check:bbox
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_ANON_KEY em scripts/.env (ver scripts/.env.example).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CENTER = { lat: -18.8582, lng: -41.9485 };
const VIEW = { w: 390, h: 844 };
const ZOOMS = [13, 15, 16];
const MAX_ITENS = 299;

// Web Mercator (mesmo do Leaflet, tiles de 256 px).
const worldPx = (z) => 256 * 2 ** z;
const lngToX = (lng, z) => ((lng + 180) / 360) * worldPx(z);
const latToY = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(z);
};
const xToLng = (x, z) => (x / worldPx(z)) * 360 - 180;
const yToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / worldPx(z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

function viewportBbox(center, z) {
  const cx = lngToX(center.lng, z);
  const cy = latToY(center.lat, z);
  return {
    west: xToLng(cx - VIEW.w / 2, z),
    east: xToLng(cx + VIEW.w / 2, z),
    north: yToLat(cy - VIEW.h / 2, z),
    south: yToLat(cy + VIEW.h / 2, z),
  };
}

async function fetchRows(b, z) {
  const { data, error } = await supabase.rpc("pontos_comunidade_bbox", {
    p_oeste: b.west,
    p_sul: b.south,
    p_leste: b.east,
    p_norte: b.north,
    p_zoom: z,
    p_categoria: null,
    p_excluir_id: null,
    p_max_itens: MAX_ITENS,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [], error: null };
}

const inside = (r, b) =>
  r.latitude !== null &&
  r.longitude !== null &&
  r.longitude >= b.west &&
  r.longitude <= b.east &&
  r.latitude >= b.south &&
  r.latitude <= b.north;

let totalMismatch = 0;
for (const z of ZOOMS) {
  const a = viewportBbox(CENTER, z);
  const shift = (a.east - a.west) * 0.15;
  const b = { ...a, west: a.west + shift, east: a.east + shift };
  const overlap = { west: b.west, east: a.east, south: a.south, north: a.north };

  const [ra, rb] = await Promise.all([fetchRows(a, z), fetchRows(b, z)]);
  if (ra.error || rb.error) {
    console.log(`zoom ${z}: erro A=${ra.error ?? "-"} B=${rb.error ?? "-"}`);
    continue;
  }
  const mapA = new Map(ra.rows.filter((r) => r.tipo !== "truncado" && inside(r, overlap)).map((r) => [r.chave, r]));
  const mapB = new Map(rb.rows.filter((r) => r.tipo !== "truncado" && inside(r, overlap)).map((r) => [r.chave, r]));

  const onlyA = [...mapA.keys()].filter((k) => !mapB.has(k));
  const onlyB = [...mapB.keys()].filter((k) => !mapA.has(k));
  const changed = [];
  for (const [k, ra1] of mapA) {
    const rb1 = mapB.get(k);
    if (!rb1) continue;
    if (
      ra1.quantidade !== rb1.quantidade ||
      Math.abs(ra1.latitude - rb1.latitude) > 1e-9 ||
      Math.abs(ra1.longitude - rb1.longitude) > 1e-9
    ) {
      changed.push(`${k} (${ra1.quantidade}→${rb1.quantidade})`);
    }
  }
  const mismatches = onlyA.length + onlyB.length + changed.length;
  totalMismatch += mismatches;
  console.log(
    `zoom ${z}: A=${ra.rows.length} linhas, B=${rb.rows.length} linhas, na sobreposição A=${mapA.size} B=${mapB.size}, ` +
      `só em A=${onlyA.length}, só em B=${onlyB.length}, alteradas=${changed.length}`
  );
  for (const k of onlyA.slice(0, 5)) console.log(`   só em A: ${k}`);
  for (const k of onlyB.slice(0, 5)) console.log(`   só em B: ${k}`);
  for (const k of changed.slice(0, 5)) console.log(`   alterada: ${k}`);
}
console.log(`Total de diferenças na sobreposição: ${totalMismatch}`);
