"use client";

import React, { useEffect, useRef } from "react";
import { TouristPoint } from "@/types/point";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface CustomMapProps {
  points: TouristPoint[];
  selectedPoint: TouristPoint | null;
  onSelectPoint: (point: TouristPoint) => void;
  userLocation: [number, number] | null;
  flyToCoords: [number, number] | null;
  reduceMotion?: boolean;
}

/**
 * Mapa Leaflet (mesma API, mesma aparência) — reescrito para aguentar muitos
 * pontos sem travar.
 *
 * O QUE CAUSAVA O TRAVAMENTO ANTES:
 *  1. O efeito dos marcadores dependia de `[points, selectedPoint, onSelectPoint, zoom]`
 *     e, em cada disparo, REMOVIA e RECRIAVA todos os marcadores. Ou seja: cada
 *     passo de zoom, cada seleção e cada render do componente pai reconstruía N
 *     ícones montando HTML por string. Com 5 pontos passava; com dezenas, não.
 *  2. O zoom era guardado em `useState`, então cada `zoomend` re-renderizava o
 *     componente inteiro só para recalcular o tamanho do pin.
 *  3. `onSelectPoint` chega como função nova a cada render do pai, o que sozinho
 *     já bastava para reconstruir tudo a cada render.
 *
 * COMO FICOU:
 *  - Marcador é criado UMA vez por ponto e reaproveitado; a lista é
 *    reconciliada por id (adiciona o que entrou, remove o que saiu).
 *  - Tamanho do pin vem da variável CSS `--pin-size`, escrita direto no
 *    container no `zoomend`. Zero re-render do React, zero HTML remontado.
 *  - Seleção alterna a classe `is-selected` no elemento que já existe.
 *  - O callback de clique fica em ref, então identidade nova não recria nada.
 *  - Tile layer com `updateWhenZooming: false` e `keepBuffer` maior: menos
 *    requisição e menos repintura durante zoom/arraste.
 */

/** Tamanho do pin (px) por nível de zoom. Tamanho grande: 40 a 68 px. Uma conta
 * só, usada na CSS var. */
function pinSizeForZoom(zoom: number): number {
  return Math.max(40, Math.min(68, Math.round(48 + (zoom - 13) * 3.2)));
}

/** Nomes vêm do banco e entram em innerHTML — escapar é obrigatório. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** HTML do pin. Não tem mais nenhum tamanho embutido: tudo sai de --pin-size
 * (ver bloco "MAPA — PINS" em globals.css), por isso o HTML nunca precisa ser
 * refeito quando o zoom muda. */
function pinHtml(point: TouristPoint): string {
  return `
    <span class="rsb-pin-halo" aria-hidden="true"></span>
    <span class="rsb-pin">
      <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    </span>
    <span class="rsb-pin-label">${escapeHtml(point.name)}</span>
  `;
}

export default function CustomMap({
  points,
  selectedPoint,
  onSelectPoint,
  userLocation,
  flyToCoords,
  reduceMotion = false,
}: CustomMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const userLocationMarkerRef = useRef<L.Marker | null>(null);

  // Callback sempre atual sem entrar em dependência de efeito: os marcadores
  // leem `onSelectRef.current` no momento do clique, então uma função nova
  // vinda do pai não recria marcador nenhum.
  const onSelectRef = useRef(onSelectPoint);
  useEffect(() => {
    onSelectRef.current = onSelectPoint;
  }, [onSelectPoint]);

  // Initialize Leaflet Map with restrictions
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Center of Governador Valadares
    const gvCenter: L.LatLngExpression = [-18.8582, -41.9485];

    // Initialize map with strict constraints
    const map = L.map(mapContainerRef.current, {
      center: gvCenter,
      zoom: 13,
      minZoom: 12, // Prevents zooming out to world map view
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    });

    // Premium clean tile layer: CartoDB Positron with API key
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_28p1_1_9a3f8de771e704501a962e61", {
      maxZoom: 19,
      // Menos trabalho durante o gesto: não recarrega tiles a cada quadro do
      // zoom e mantém uma borda extra pronta ao arrastar.
      updateWhenZooming: false,
      keepBuffer: 3,
    }).addTo(map);

    mapRef.current = map;

    // Tamanho do pin como variável CSS — escrita imperativa, sem estado React,
    // então mexer o zoom não re-renderiza a árvore.
    const container = mapContainerRef.current;
    const applyPinSize = () => {
      container.style.setProperty("--pin-size", `${pinSizeForZoom(map.getZoom())}px`);
    };
    applyPinSize();
    map.on("zoomend", applyPinSize);

    // Handle screen resize / device orientation changes (essential for tablets & responsive viewports)
    const handleResize = () => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    };
    window.addEventListener("resize", handleResize);

    // Clean up on unmount
    return () => {
      window.removeEventListener("resize", handleResize);
      map.off("zoomend", applyPinSize);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Reconciliação dos marcadores: cria o que falta, remove o que saiu, e deixa
  // em paz o que já existe. Depende só de `points`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = markersRef.current;
    const currentIds = new Set(points.map((p) => p.id));

    for (const [id, marker] of Object.entries(markers)) {
      if (!currentIds.has(id)) {
        marker.remove();
        delete markers[id];
      }
    }

    for (const point of points) {
      const existing = markers[point.id];
      if (existing) {
        // Ponto editado no painel pode ter mudado de coordenada/nome.
        const current = existing.getLatLng();
        if (current.lat !== point.coords.lat || current.lng !== point.coords.lng) {
          existing.setLatLng([point.coords.lat, point.coords.lng]);
        }
        const label = existing.getElement()?.querySelector(".rsb-pin-label");
        if (label && label.textContent !== point.name) label.textContent = point.name;
        continue;
      }

      const icon = L.divIcon({
        className: "rsb-marker",
        html: pinHtml(point),
        // Tamanho zero de propósito: o pin é posicionado e dimensionado por CSS
        // a partir de --pin-size, e o clique acontece no filho visível. Assim o
        // ícone nunca precisa ser recriado quando o zoom muda.
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker([point.coords.lat, point.coords.lng], {
        icon,
        // keyboard: true (default) dá tabindex ao marcador; role + aria-label
        // abaixo dão papel e nome acessível (WCAG 4.1.2 / 2.4.4).
        keyboard: true,
        alt: `${point.name} — ${point.category}`,
        title: `${point.name} — ${point.category}`,
      })
        .addTo(map)
        .on("click", () => onSelectRef.current(point))
        .on("keypress", (event: L.LeafletKeyboardEvent) => {
          if (event.originalEvent.key === "Enter" || event.originalEvent.key === " ") {
            event.originalEvent.preventDefault();
            onSelectRef.current(point);
          }
        });

      const element = marker.getElement();
      if (element) {
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", `Abrir ${point.name}, ${point.category}`);
      }

      markers[point.id] = marker;
    }
  }, [points]);

  // Seleção: alterna classe/atributo nos elementos existentes. Nenhum marcador
  // é recriado (era aqui que o mapa engasgava ao tocar em um pin).
  useEffect(() => {
    for (const [id, marker] of Object.entries(markersRef.current)) {
      const element = marker.getElement();
      if (!element) continue;
      const isSelected = selectedPoint?.id === id;
      element.classList.toggle("is-selected", isSelected);
      if (isSelected) element.setAttribute("aria-current", "true");
      else element.removeAttribute("aria-current");
    }
  }, [selectedPoint, points]);

  // Handle User Geolocation Blue Pulse Dot
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (userLocationMarkerRef.current) {
      userLocationMarkerRef.current.remove();
      userLocationMarkerRef.current = null;
    }

    if (userLocation) {
      const blueDotIcon = L.divIcon({
        className: "user-location-marker",
        html: `
          <div class="relative flex items-center justify-center">
            <span class="absolute w-8 h-8 rounded-full bg-blue-500/30 user-location-pulse"></span>
            <div class="w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-md"></div>
          </div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      userLocationMarkerRef.current = L.marker(userLocation, {
        icon: blueDotIcon,
        keyboard: false,
        interactive: false,
        alt: "Sua localização aproximada",
      }).addTo(map);
    }
  }, [userLocation]);

  // Helper to ensure Leaflet never receives NaN coordinates
  const isValidLatLng = (lat: number, lng: number) =>
    typeof lat === "number" && typeof lng === "number" && !isNaN(lat) && !isNaN(lng);

  // Fly to selected point if changed from outside
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPoint || !selectedPoint.coords) return;
    const { lat, lng } = selectedPoint.coords;
    if (!isValidLatLng(lat, lng)) return;

    map.flyTo([lat, lng], 15, {
      animate: !reduceMotion,
      duration: reduceMotion ? 0 : 1.5,
    });
  }, [selectedPoint, reduceMotion]);

  // Fly to user coordinates on location centering trigger
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToCoords) return;
    const [lat, lng] = flyToCoords;
    if (!isValidLatLng(lat, lng)) return;

    map.flyTo([lat, lng], 15, {
      animate: !reduceMotion,
      duration: reduceMotion ? 0 : 1.5,
    });
  }, [flyToCoords, reduceMotion]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* Map Container Element */}
      <div ref={mapContainerRef} className="w-full h-full z-10" />
    </div>
  );
}
