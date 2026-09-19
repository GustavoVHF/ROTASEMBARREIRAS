"use client";

import React, { useEffect, useRef, useState } from "react";
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
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const userLocationMarkerRef = useRef<L.Marker | null>(null);

  // Active zoom state to dynamically adjust marker sizes
  const [zoom, setZoom] = useState(13);

  // Initialize Leaflet Map with restrictions
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Center of Governador Valadares
    const gvCenter: L.LatLngExpression = [-18.8582, -41.9485];
    
    // Bounds to restrict panning/zooming out of G. Valadares (prevents gray border/empty areas)
    const gvBounds = L.latLngBounds([-18.96, -42.06], [-18.78, -41.86]);

    // Initialize map with strict constraints
    const map = L.map(mapContainerRef.current, {
      center: gvCenter,
      zoom: 13,
      minZoom: 12, // Prevents zooming out to world map view
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false,
    });

    // Premium clean tile layer: CartoDB Positron with API key
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_28p1_1_9a3f8de771e704501a962e61", {
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    // Track active zoom changes
    map.on("zoomend", () => {
      setZoom(map.getZoom());
    });

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
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update markers and handle selections/zoomed sizes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing markers
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    // Dynamic marker size based on active zoom level (slightly larger for accessibility)
    const markerSize = Math.max(34, Math.min(68, 42 + (zoom - 13) * 5));

    // Add new markers
    points.forEach((point) => {
      const isSelected = selectedPoint?.id === point.id;

      // Custom DOM icon matching the orange brand design system exactly with dynamic size
      const customIcon = L.divIcon({
        className: "custom-leaflet-marker",
        html: `
          <div class="relative flex items-center justify-center">
            ${isSelected ? `<span class="absolute rounded-full bg-brand/20 animate-ping" style="width: ${markerSize * 1.3}px; height: ${markerSize * 1.3}px;"></span>` : ""}
            <div class="rounded-full bg-brand border-2 border-white flex items-center justify-center shadow-lg transition-transform duration-200 active:scale-95 ${
              isSelected ? "ring-4 ring-brand/20 scale-110" : ""
            }" style="width: ${markerSize}px; height: ${markerSize}px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="${markerSize * 0.45}" height="${markerSize * 0.45}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
            <div class="absolute bg-white border border-gray-100/80 px-2 py-0.5 rounded-md text-[9px] font-black shadow-sm whitespace-nowrap pointer-events-none transition-transform ${
              isSelected ? "text-brand scale-105 font-black border-brand/20" : "text-text-main opacity-85 scale-95"
            }" style="top: ${markerSize + 3}px;">
              ${point.name}
            </div>
          </div>
        `,
        iconSize: [markerSize, markerSize],
        iconAnchor: [markerSize / 2, markerSize / 2],
      });

      // keyboard: true é o default do Leaflet e dá tabindex ao marcador, mas
      // sem role/nome acessível o leitor de tela anuncia um elemento vazio.
      // `alt` + os atributos aplicados abaixo dão nome e papel ao marcador
      // (WCAG 4.1.2 / 2.4.4).
      const marker = L.marker([point.coords.lat, point.coords.lng], {
        icon: customIcon,
        keyboard: true,
        alt: `${point.name} — ${point.category}`,
        title: `${point.name} — ${point.category}`,
      })
        .addTo(map)
        .on("click", () => {
          onSelectPoint(point);
        })
        // Enter/Espaço no marcador focado abrem o ponto, igual ao clique.
        .on("keypress", (event: L.LeafletKeyboardEvent) => {
          if (event.originalEvent.key === "Enter" || event.originalEvent.key === " ") {
            event.originalEvent.preventDefault();
            onSelectPoint(point);
          }
        });

      // divIcon não aceita `alt`, então o nome acessível vai direto no
      // elemento do marcador.
      const element = marker.getElement();
      if (element) {
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", `Abrir ${point.name}, ${point.category}`);
        if (isSelected) element.setAttribute("aria-current", "true");
      }

      markersRef.current[point.id] = marker;
    });
  }, [points, selectedPoint, onSelectPoint, zoom]);

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

      userLocationMarkerRef.current = L.marker(userLocation, { icon: blueDotIcon })
        .addTo(map);
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
