/**
 * Camada de pontos "Em mapeamento" (comunidade / OpenStreetMap) no mapa.
 *
 * Sem React de propósito, para manter o CustomMap enxuto:
 *  - ligada em todo zoom a partir de MIN_COMMUNITY_ZOOM (= minZoom do mapa);
 *  - pede à RPC pontos_comunidade_bbox uma área MAIOR que a tela
 *    (padBbox, FETCH_PAD) e não pede de novo enquanto a tela continuar
 *    dentro dela com o mesmo zoom/categoria/selecionado — arrastar um pouco
 *    não gera pedido nem troca marcadores;
 *  - debounce de 300 ms, cancela o pedido anterior e descarta resposta velha;
 *    nunca limpa os marcadores antes da resposta nova chegar;
 *  - reconcilia por `chave`: remove só o que saiu, cria só o novo e atualiza
 *    no lugar (posição, contagem, nome) o que continua;
 *  - o pin selecionado é o mesmo elemento do pin normal (só ganha a classe
 *    is-selected) e volta a ser normal ao desmarcar, sem sumir e voltar;
 *  - pin vazado (contorno) com o nome ao lado, como o oficial — a diferença
 *    é de preenchimento, não de cor. Grupos mostram só a quantidade.
 */
import L from "leaflet";
import type { CommunityLayerRow } from "@/types/database";
import type { TouristPoint } from "@/types/point";
import { fetchCommunityLayer } from "@/services/communityPointsService";
import { escapeHtml } from "@/components/map/escapeHtml";
import {
  clampBbox,
  containsBbox,
  FETCH_PAD,
  MAX_BBOX_SPAN,
  padBbox,
  sameQuery,
  type Bbox,
  type LayerQuery,
} from "@/components/map/communityViewport";

export const MIN_COMMUNITY_ZOOM = 12;

/** Zoom mínimo ao focar um ponto selecionado (flyTo nunca afasta). */
export const SELECT_FOCUS_ZOOM = 15;

/** 299 + o pin selecionado = no máximo 300 elementos no DOM (área pedida = 4× a tela). */
const MAX_ITENS = 299;
const DEBOUNCE_MS = 300;

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

function pinLabel(nome: string, categoria: string) {
  return { title: `${nome} — ${categoria}, em mapeamento`, aria: `Abrir ${nome}, ${categoria}, em mapeamento` };
}

function clusterLabel(quantidade: number) {
  return `${quantidade} locais da comunidade, ampliar`;
}

function isBboxTooLarge(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.includes("bbox_grande_demais");
}

export class CommunityLayerController {
  private map: L.Map;
  private onSelect: (row: CommunityLayerRow) => void;
  private group: L.LayerGroup;
  private markers = new Map<string, L.Marker>();
  /** Última linha recebida por chave (lida pelos cliques). */
  private rows = new Map<string, CommunityLayerRow>();
  private selectedMarker: L.Marker | null = null;
  private selectedRow: CommunityLayerRow | null = null;
  private selected: TouristPoint | null = null;
  private enabled = false;
  private category: string | null = null;
  private reduceMotion = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private seq = 0;
  private destroyed = false;
  private lastFetched: { bbox: Bbox; query: LayerQuery } | null = null;
  private inFlight: { bbox: Bbox; query: LayerQuery } | null = null;

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

    this.releaseSelectedMarker();
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
    this.rows.clear();
    this.selectedMarker = null;
    this.selectedRow = null;
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
    this.inFlight = null;
    this.lastFetched = null;
    for (const marker of this.markers.values()) this.group.removeLayer(marker);
    this.markers.clear();
    this.rows.clear();
  }

  private async refresh() {
    if (this.destroyed) return;
    if (!this.enabled || this.map.getZoom() < MIN_COMMUNITY_ZOOM) {
      this.clear();
      return;
    }

    const b = this.map.getBounds();
    const viewport: Bbox = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    const query: LayerQuery = {
      zoom: Math.floor(this.map.getZoom()),
      category: this.category,
      excludeId: this.selected?.status === "em_mapeamento" ? this.selected.id : null,
    };

    // A tela ainda está dentro da área já carregada (ou em carregamento).
    if (this.lastFetched && sameQuery(this.lastFetched.query, query) && containsBbox(this.lastFetched.bbox, viewport)) {
      return;
    }
    if (this.inFlight && sameQuery(this.inFlight.query, query) && containsBbox(this.inFlight.bbox, viewport)) {
      return;
    }

    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.seq += 1;
    const mySeq = this.seq;

    const padded = clampBbox(padBbox(viewport, FETCH_PAD), MAX_BBOX_SPAN);
    const request = (bounds: Bbox) =>
      fetchCommunityLayer({
        bounds,
        zoom: query.zoom,
        category: query.category,
        excludeId: query.excludeId,
        maxItens: MAX_ITENS,
        signal: controller.signal,
      });

    this.inFlight = { bbox: padded, query };
    try {
      let fetched = padded;
      let rows: CommunityLayerRow[];
      try {
        rows = await request(padded);
      } catch (error) {
        // RPC antiga (antes da migração 04) recusa áreas > 0,25°: tenta só a tela.
        if (!isBboxTooLarge(error) || controller.signal.aborted || mySeq !== this.seq) throw error;
        fetched = viewport;
        this.inFlight = { bbox: viewport, query };
        rows = await request(viewport);
      }
      if (mySeq !== this.seq || this.destroyed) return; // resposta obsoleta
      this.inFlight = null;
      this.lastFetched = { bbox: fetched, query };
      this.reconcile(rows);
    } catch (error) {
      if (mySeq === this.seq) this.inFlight = null;
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
        this.rows.delete(key);
      }
    }
    for (const row of drawable) {
      const existing = this.markers.get(row.chave);
      if (existing) {
        this.updateMarker(existing, this.rows.get(row.chave), row);
      } else {
        const marker = row.tipo === "grupo" ? this.createCluster(row) : this.createPin(row);
        this.markers.set(row.chave, marker);
      }
      this.rows.set(row.chave, row);
    }
  }

  /** Atualiza no lugar um marcador que continua na resposta. */
  private updateMarker(marker: L.Marker, prev: CommunityLayerRow | undefined, row: CommunityLayerRow) {
    const lat = row.latitude as number;
    const lng = row.longitude as number;
    const pos = marker.getLatLng();
    if (pos.lat !== lat || pos.lng !== lng) marker.setLatLng([lat, lng]);

    const element = marker.getElement();
    const icon = marker.options.icon as L.DivIcon | undefined;
    if (row.tipo === "grupo") {
      if (prev?.quantidade === row.quantidade) return;
      const label = clusterLabel(row.quantidade);
      if (icon) icon.options.html = clusterHtml(row.quantidade);
      marker.options.title = label;
      marker.options.alt = label;
      if (element) {
        const bubble = element.querySelector(".rsb-cluster");
        if (bubble) bubble.textContent = String(row.quantidade);
        element.title = label;
        element.setAttribute("aria-label", label);
      }
      return;
    }

    if (prev?.nome === row.nome && prev?.categoria === row.categoria) return;
    const nome = row.nome ?? "";
    const labels = pinLabel(nome, row.categoria ?? "");
    if (icon) icon.options.html = communityPinHtml(nome);
    marker.options.title = labels.title;
    marker.options.alt = labels.title;
    if (element) {
      const text = element.querySelector(".rsb-pin-label");
      if (text) text.textContent = nome;
      element.title = labels.title;
      element.setAttribute("aria-label", labels.aria);
    }
  }

  /** Clique/Enter lê a linha atual da chave (contagem e limites atualizados). */
  private activate(key: string) {
    const row = this.rows.get(key) ?? (this.selectedRow?.chave === key ? this.selectedRow : null);
    if (!row) return;
    if (row.tipo === "grupo") this.zoomToCluster(row);
    else this.onSelect(row);
  }

  private bindActivate(marker: L.Marker, key: string) {
    const activate = () => this.activate(key);
    marker.on("click", activate).on("keypress", (event: L.LeafletKeyboardEvent) => {
      if (event.originalEvent.key === "Enter" || event.originalEvent.key === " ") {
        event.originalEvent.preventDefault();
        activate();
      }
    });
  }

  private makePinMarker(key: string, lat: number, lng: number, nome: string, categoria: string): L.Marker {
    const icon = L.divIcon({
      className: "rsb-marker rsb-marker--community",
      html: communityPinHtml(nome),
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    const labels = pinLabel(nome, categoria);
    const marker = L.marker([lat, lng], {
      icon,
      keyboard: true,
      alt: labels.title,
      title: labels.title,
      zIndexOffset: -1000, // oficiais por cima
    });
    marker.addTo(this.group);
    const element = marker.getElement();
    if (element) {
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", labels.aria);
      element.setAttribute("data-map-marker", "");
      element.setAttribute("data-chave", key);
    }
    this.bindActivate(marker, key);
    return marker;
  }

  private createPin(row: CommunityLayerRow): L.Marker {
    return this.makePinMarker(
      row.chave,
      row.latitude as number,
      row.longitude as number,
      row.nome ?? "",
      row.categoria ?? ""
    );
  }

  private createCluster(row: CommunityLayerRow): L.Marker {
    const icon = L.divIcon({
      className: "rsb-cluster-marker",
      html: clusterHtml(row.quantidade),
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    const label = clusterLabel(row.quantidade);
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
      element.setAttribute("data-chave", row.chave);
    }
    this.bindActivate(marker, row.chave);
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
    const key = `p:${point.id}`;
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
    // Se o ponto já está como pin individual, reaproveita o mesmo elemento.
    let marker = this.markers.get(key);
    if (marker) {
      this.markers.delete(key);
      this.rows.delete(key);
    } else {
      marker = this.makePinMarker(key, point.coords.lat, point.coords.lng, point.name, point.category);
    }
    marker.getElement()?.classList.add("is-selected");
    marker.getElement()?.setAttribute("aria-current", "true");
    this.selectedRow = row;
    this.selectedMarker = marker;
  }

  /** Ao desmarcar, o selecionado volta a ser um pin normal (não some). O
   * próximo reconcile o remove só se o servidor não o devolver mais. */
  private releaseSelectedMarker() {
    const marker = this.selectedMarker;
    const row = this.selectedRow;
    this.selectedMarker = null;
    this.selectedRow = null;
    if (!marker || !row) return;
    if (this.markers.has(row.chave)) {
      this.group.removeLayer(marker);
      return;
    }
    marker.getElement()?.classList.remove("is-selected");
    marker.getElement()?.removeAttribute("aria-current");
    this.markers.set(row.chave, marker);
    this.rows.set(row.chave, row);
  }

  private removeSelectedMarker() {
    if (this.selectedMarker) {
      this.group.removeLayer(this.selectedMarker);
      this.selectedMarker = null;
      this.selectedRow = null;
    }
  }
}
