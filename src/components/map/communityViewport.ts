/**
 * Geometria pura da camada "Em mapeamento" (sem imports, testável com
 * node --test em scripts/ui/communityViewport.test.mjs).
 *
 * O controlador pede ao servidor uma área MAIOR que a tela (padBbox) e não
 * pede de novo enquanto a tela continuar dentro dela (containsBbox), para os
 * marcadores não sumirem/piscarem ao arrastar o mapa.
 */

export type Bbox = { west: number; south: number; east: number; north: number };

/** Mesmo `zoom`/categoria/excluído = mesma resposta do servidor. */
export type LayerQuery = { zoom: number; category: string | null; excludeId: string | null };

/** Maior lado aceito pela RPC pontos_comunidade_bbox (migrations_osm_04). */
export const MAX_BBOX_SPAN = 1.5;

/** Margem pedida em volta da tela: 0.5 = metade da largura/altura de cada lado. */
export const FETCH_PAD = 0.5;

/** Semântica de L.LatLngBounds.pad: cada lado cresce `ratio × tamanho`. */
export function padBbox(b: Bbox, ratio: number): Bbox {
  const dx = (b.east - b.west) * ratio;
  const dy = (b.north - b.south) * ratio;
  return { west: b.west - dx, south: b.south - dy, east: b.east + dx, north: b.north + dy };
}

/** Mantém o centro e limita cada lado a `maxSpan` graus. */
export function clampBbox(b: Bbox, maxSpan: number): Bbox {
  let { west, south, east, north } = b;
  if (east - west > maxSpan) {
    const cx = (west + east) / 2;
    west = cx - maxSpan / 2;
    east = cx + maxSpan / 2;
  }
  if (north - south > maxSpan) {
    const cy = (south + north) / 2;
    south = cy - maxSpan / 2;
    north = cy + maxSpan / 2;
  }
  return { west, south, east, north };
}

/** `inner` inteiramente dentro de `outer` (bordas iguais contam como dentro). */
export function containsBbox(outer: Bbox, inner: Bbox): boolean {
  return (
    inner.west >= outer.west &&
    inner.east <= outer.east &&
    inner.south >= outer.south &&
    inner.north <= outer.north
  );
}

export function sameQuery(a: LayerQuery | null, b: LayerQuery | null): boolean {
  if (!a || !b) return false;
  return a.zoom === b.zoom && a.category === b.category && a.excludeId === b.excludeId;
}
