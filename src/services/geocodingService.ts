/**
 * Address/place geocoding via Photon (https://photon.komoot.io/api/),
 * an OpenStreetMap-based geocoder. No API key required.
 *
 * Usage policy: Photon's public instance is free but not meant for high
 * volume. Caller (SearchBar) must debounce keystrokes — this service
 * itself adds no debounce, that's the UI's job. One request per search,
 * not per keystroke.
 *
 * Self-host ready: base URL comes from NEXT_PUBLIC_PHOTON_URL if set,
 * falls back to the public instance. Swap to a self-hosted Photon by
 * setting that env var — no code change needed here.
 */

const PHOTON_BASE_URL = process.env.NEXT_PUBLIC_PHOTON_URL || "https://photon.komoot.io/api/";

// Bias results toward Governador Valadares, MG (app's operating area).
const GV_LAT = -18.8582;
const GV_LON = -41.9485;

export interface AddressResult {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

function buildLabel(properties: Record<string, unknown>): string {
  const parts = [
    properties.name,
    properties.street,
    properties.district,
    properties.city,
    properties.state,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  // dedupe consecutive repeats (Photon sometimes repeats name/city)
  const deduped = parts.filter((part, i) => part !== parts[i - 1]);
  return deduped.join(", ");
}

/**
 * Queries Photon for address/place suggestions near Governador Valadares.
 * Pass an AbortSignal to cancel superseded requests when the user keeps typing.
 */
/**
 * Geocodificação reversa (coordenada -> nome de cidade) pelo mesmo Photon.
 * Usada só para dizer ao usuário em que cidade ele parece estar; NUNCA pede
 * permissão de localização — recebe coordenadas que o app já tem.
 *
 * Retorna null em qualquer falha (offline, 4xx, timeout): quem chama precisa
 * tratar "cidade desconhecida" como caso normal, não como erro.
 */
export async function reverseGeocodeCity(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const url = new URL("reverse", PHOTON_BASE_URL.endsWith("/") ? PHOTON_BASE_URL : `${PHOTON_BASE_URL}/`);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("limit", "1");
    url.searchParams.set("lang", "default");

    const response = await fetch(url.toString(), { signal });
    if (!response.ok) return null;
    const geojson = await response.json();
    const properties = geojson?.features?.[0]?.properties as Record<string, unknown> | undefined;
    if (!properties) return null;

    // Photon usa city para municípios e county/district para áreas rurais.
    for (const key of ["city", "county", "district", "locality", "state"]) {
      const value = properties[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return []; // avoid firing on 1-2 char noise

  const url = new URL(PHOTON_BASE_URL);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("lat", String(GV_LAT));
  url.searchParams.set("lon", String(GV_LON));
  url.searchParams.set("limit", "5");
  // Photon's public instance only supports lang values: default, de, en, fr —
  // "pt" caused a 400 Bad Request. "default" returns each place's local-language
  // name (closest to Portuguese results for BR addresses without forcing "en").
  url.searchParams.set("lang", "default");

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) throw new Error(`Photon request failed: ${response.status}`);

  const geojson = await response.json();
  const features: Array<{
    geometry: { coordinates: [number, number] };
    properties: Record<string, unknown>;
  }> = geojson.features ?? [];

  return features.map((feature, index) => ({
    id: `photon-${index}-${feature.geometry.coordinates.join(",")}`,
    label: buildLabel(feature.properties) || trimmed,
    lat: feature.geometry.coordinates[1], // GeoJSON = [lon, lat]
    lng: feature.geometry.coordinates[0],
  }));
}
