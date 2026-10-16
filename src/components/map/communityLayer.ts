/**
 * Camada de pontos "Em mapeamento" (comunidade / OpenStreetMap) no mapa.
 *
 * Sem React de propósito, para manter o CustomMap enxuto:
 *  - só a partir do zoom MIN_COMMUNITY_ZOOM e só com o filtro ligado;
 *  - carrega apenas a área visível (bbox) pela RPC pontos_comunidade_bbox,
 *    que já devolve os pontos agrupados (cluster por grade no servidor);
 *  - debounce de 400 ms, cancela o pedido anterior e descarta resposta velha;
 *  - reconcilia marcadores por `chave` (cria só o novo, remove só o que saiu);
 *  - pin vazado (contorno) — a diferença para o oficial é de preenchimento,
 *    não de cor.
 */
import L from "leaflet";
import type { CommunityLayerRow } from "@/types/database";
import type { TouristPoint } from "@/types/point";
import { fetchCommunityLayer } from "@/services/communityPointsService";
import { escapeHtml } from "@/components/map/escapeHtml";

export const MIN_COMMUNITY_ZOOM = 15;

/** 149 + o pin selecionado desenhado à parte = no máximo 150 elementos no DOM. */
const MAX_ITENS = 149;
const DEBOUNCE_MS = 400;

const isDev = process.env.NODE_ENV !== "production";

/** Mesmo markup do pin oficial (pinHtml do CustomMap), com o traço em
 * currentColor: a cor do contorno vem do CSS (.rsb-marker--community). */
function communityPinHtml(nome: string): string {
  return `<span class="rsb-pin-halo" aria-hidden="true"></span>
    <span class="rsb-pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>
    <span class="rsb-pin-label">${escapeHtml(nome)}</span>`;
}

function clusterHtml(quantidade: number): string {
  return `<span class="rsb-cluster" aria-hidden="true">${quantidade}</span>`;
}

export class CommunityLayerController {
  private map: L.Map;
  private onSelect: (row: CommunityLayerRow) => void;
  private group: L.LayerGroup;
  private markers = new Map<string, L.Marker>();
  private selectedMarker: L.Marker | null = null;
  private selected: TouristPoint | null = null;
  private enabled = false;
  private category: string | null = null;
  private reduceMotion = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private seq = 0;
  private destroyed = false;

  constructor(map: L.Map, opts: { onSelect: (row: CommunityLayerRow) => void }) {
    this.map = map;
    this.onSelect = opts.onSelect;
    this.group = L.layerGroup().addTo(map);
    this.map.on("moveend", this.schedule);
    this.map.on("zoomend", this.schedule);
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
      this.removeSelectedMarker();
    } else if (this.selected?.status === "em_mapeamento") {
      this.drawSelectedMarker(this.selected);
    }
    this.schedule();
  }

  setCategory(category: string | null) {
    if (this.category === category) return;
    this.category = category;
    this.schedule();
  }

  setReduceMotion(reduceMotion: boolean) {
    this.reduceMotion = reduceMotion;
  }

  setSelected(point: TouristPoint | null) {
    const prevId = this.selected?.status === "em_mapeamento" ? this.selected.id : null;
    const nextId = point?.status === "em_mapeamento" ? point.id : null;
    this.selected = point;
    if (prevId === nextId) return;

    this.removeSelectedMarker();
    if (point && nextId && this.enabled) {
      this.drawSelectedMarker(point);
    }
    this.schedule();
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.abortController?.abort();
    this.map.off("moveend", this.schedule);
    this.map.off("zoomend", this.schedule);
    this.group.clearLayers();
    this.group.remove();
    this.markers.clear();
    this.selectedMarker = null;
  }

  private schedule = () => {
    if (this.destroyed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, DEBOUNCE_MS);
  };

  private clear() {
    this.abortController?.abort();
    this.abortController = null;
    this.seq += 1;
    for (const marker of this.markers.values()) this.group.removeLayer(marker);
    this.markers.clear();
  }

  private async refresh() {
    if (this.destroyed) return;
    if (!this.enabled || this.map.getZoom() < MIN_COMMUNITY_ZOOM) {
      this.clear();
      return;
    }

    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.seq += 1;
    const mySeq = this.seq;

    const b = this.map.getBounds();
    try {
      const rows = await fetchCommunityLayer({
        bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        zoom: this.map.getZoom(),
        category: this.category,
        excludeId: this.selected?.status === "em_mapeamento" ? this.selected.id : null,
        maxItens: MAX_ITENS,
        signal: controller.signal,
      });
      if (mySeq !== this.seq || this.destroyed) return; // resposta obsoleta
      this.reconcile(rows);
    } catch (error) {
      // Recuperável: mantém os marcadores atuais; o próximo movimento tenta de novo.
      if (isDev && !controller.signal.aborted) console.warn("[comunidade] bbox falhou", error);
    }
  }

  private reconcile(rows: CommunityLayerRow[]) {
    const drawable: CommunityLayerRow[] = [];
    for (const row of rows) {
      if (row.tipo === "truncado") {
        if (isDev) console.warn(`[comunidade] resposta truncada: ${row.quantidade} itens omitidos`);
        continue;
      }
      if (row.latitude === null || row.longitude === null) continue;
      // O selecionado é desenhado à parte (selectedMarker).
      if (row.tipo === "ponto" && this.selectedMarker && row.ponto_id === this.selected?.id) continue;
      drawable.push(row);
    }

    const keys = new Set(drawable.map((r) => r.chave));
    for (const [key, marker] of this.markers) {
      if (!keys.has(key)) {
        this.group.removeLayer(marker);
        this.markers.delete(key);
      }
    }
    for (const row of drawable) {
      if (this.markers.has(row.chave)) continue;
      const marker = row.tipo === "grupo" ? this.createCluster(row) : this.createPin(row);
      this.markers.set(row.chave, marker);
    }
  }

  private bindActivate(marker: L.Marker, activate: () => void) {
    marker.on("click", activate).on("keypress", (event: L.LeafletKeyboardEvent) => {
      if (event.originalEvent.key === "Enter" || event.originalEvent.key === " ") {
        event.originalEvent.preventDefault();
        activate();
      }
    });
  }

  private makePinMarker(lat: number, lng: number, nome: string, categoria: string): L.Marker {
    const icon = L.divIcon({
      className: "rsb-marker rsb-marker--community",
      html: communityPinHtml(nome),
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    const label = `${nome} — ${categoria}, em mapeamento`;
    const marker = L.marker([lat, lng], {
      icon,
      keyboard: true,
      alt: label,
      title: label,
      zIndexOffset: -1000, // oficiais por cima
    });
    marker.addTo(this.group);
    const element = marker.getElement();
    if (element) {
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", `Abrir ${nome}, ${categoria}, em mapeamento`);
      element.setAttribute("data-map-marker", "");
    }
    return marker;
  }

  private createPin(row: CommunityLayerRow): L.Marker {
    const nome = row.nome ?? "";
    const categoria = row.categoria ?? "";
    const marker = this.makePinMarker(row.latitude as number, row.longitude as number, nome, categoria);
    this.bindActivate(marker, () => this.onSelect(row));
    return marker;
  }

  private createCluster(row: CommunityLayerRow): L.Marker {
    const icon = L.divIcon({
      className: "rsb-cluster-marker",
      html: clusterHtml(row.quantidade),
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    const label = `${row.quantidade} locais da comunidade, ampliar`;
    const marker = L.marker([row.latitude as number, row.longitude as number], {
      icon,
      keyboard: true,
      alt: label,
      title: label,
      zIndexOffset: -1000,
    });
    marker.addTo(this.group);
    const element = marker.getElement();
    if (element) {
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", label);
      element.setAttribute("data-map-marker", "");
    }
    this.bindActivate(marker, () => this.zoomToCluster(row));
    return marker;
  }

  private zoomToCluster(row: CommunityLayerRow) {
    const zoom = this.map.getZoom();
    const maxZoom = Math.min(zoom + 2, 18);
    const animate = !this.reduceMotion;
    const { sul, oeste, norte, leste } = row;
    if (sul === null || oeste === null || norte === null || leste === null || (sul === norte && oeste === leste)) {
      this.map.setView([row.latitude as number, row.longitude as number], maxZoom, { animate });
      return;
    }
    this.map.fitBounds(
      [
        [sul, oeste],
        [norte, leste],
      ],
      { padding: [48, 48], maxZoom, animate }
    );
  }

  private drawSelectedMarker(point: TouristPoint) {
    // Se o ponto já estava como pin individual, tira para não haver dois.
    const key = `p:${point.id}`;
    const existing = this.markers.get(key);
    if (existing) {
      this.group.removeLayer(existing);
      this.markers.delete(key);
    }
    const marker = this.makePinMarker(point.coords.lat, point.coords.lng, point.name, point.category);
    marker.getElement()?.classList.add("is-selected");
    marker.getElement()?.setAttribute("aria-current", "true");
    const row: CommunityLayerRow = {
      tipo: "ponto",
      chave: key,
      ponto_id: point.id,
      nome: point.name,
      categoria: point.category,
      latitude: point.coords.lat,
      longitude: point.coords.lng,
      quantidade: 1,
      sul: null,
      oeste: null,
      norte: null,
      leste: null,
    };
    this.bindActivate(marker, () => this.onSelect(row));
    this.selectedMarker = marker;
  }

  private removeSelectedMarker() {
    if (this.selectedMarker) {
      this.group.removeLayer(this.selectedMarker);
      this.selectedMarker = null;
    }
  }
}
