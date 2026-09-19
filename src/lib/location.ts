/**
 * Utilidades de localização usadas para saber se o usuário está dentro da área
 * atendida pelo website (hoje só Governador Valadares/MG).
 *
 * Nenhuma função aqui PEDE permissão de localização. Todas recebem
 * coordenadas que o app já obteve — se o usuário não autorizou, nada acontece.
 */

/** Centro aproximado de Governador Valadares (mesmas coordenadas usadas como
 * viés de busca no geocodingService). */
export const GV_CENTER: [number, number] = [-18.8582, -41.9485];

/**
 * Raio considerado "dentro da cidade", em km. O município tem ~2.300 km² e
 * cerca de 30 km de extensão no eixo maior, então 30 km a partir do centro
 * cobre a área urbana e os distritos sem acusar falso positivo em quem está
 * na cidade vizinha.
 */
export const GV_RADIUS_KM = 30;

/** Distância em km entre dois pontos (Haversine). */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Heurística puramente geométrica, sem rede: serve como primeiro filtro. */
export function isNearGovernadorValadares(coords: [number, number]): boolean {
  return distanceKm(coords, GV_CENTER) <= GV_RADIUS_KM;
}

/** Reconhece o nome da cidade como Governador Valadares em qualquer variação
 * que o geocodificador devolva ("Governador Valadares", "Gov. Valadares"). */
export function isGovernadorValadaresName(city: string | null | undefined): boolean {
  if (!city) return false;
  const normalized = city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized.includes("valadares");
}
