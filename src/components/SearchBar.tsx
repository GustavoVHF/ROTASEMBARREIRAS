"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, QrCode, X, MapPin, Landmark } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { TouristPoint } from "@/types/point";
import { searchAddresses, AddressResult } from "@/services/geocodingService";
import { track } from "@/lib/analytics";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

interface SearchBarProps {
  points: TouristPoint[];
  onSelectPoint: (point: TouristPoint) => void;
  onSelectAddress: (address: AddressResult) => void;
  onOpenScanner: () => void;
  selectedPointId?: string;
}

// Debounce delay for Photon requests — respects its usage policy (no
// request per keystroke). Local ponto filtering stays instant since
// it's a cheap in-memory filter, no network involved.
const PHOTON_DEBOUNCE_MS = 400;

export default function SearchBar({
  points,
  onSelectPoint,
  onSelectAddress,
  onOpenScanner,
  selectedPointId,
}: SearchBarProps) {
  const { preferences } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;
  const [query, setQuery] = useState("");
  const [pointSuggestions, setPointSuggestions] = useState<TouristPoint[]>([]);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressResult[]>([]);
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Instant local filter over cadastro'd pontos — no network, no debounce needed.
  useEffect(() => {
    if (query.trim() === "") {
      setPointSuggestions([]);
      return;
    }
    const filtered = points.filter(
      (point) =>
        point.name.toLowerCase().includes(query.toLowerCase()) ||
        point.category.toLowerCase().includes(query.toLowerCase())
    );
    setPointSuggestions(filtered);
  }, [query, points]);

  // Debounced Photon geocoding — one request per pause in typing, not per keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 3) {
      setAddressSuggestions([]);
      setIsLoadingAddresses(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort(); // cancel any in-flight request superseded by newer typing
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoadingAddresses(true);
      searchAddresses(query, controller.signal)
        .then((results) => {
          setAddressSuggestions(results);
          setIsLoadingAddresses(false);
        })
        .catch((err) => {
          if (err.name !== "AbortError") setIsLoadingAddresses(false);
        });
    }, PHOTON_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Reset search when selectedPointId changes from outside
  useEffect(() => {
    if (!selectedPointId) {
      setQuery("");
    }
  }, [selectedPointId]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectPointSuggestion = (point: TouristPoint) => {
    // Medição: a busca terminou em um ponto do cadastro. NUNCA vai o texto
    // digitado — apenas o tipo de resultado e quantos caracteres foram usados.
    track("busca_realizada", { tipo: "ponto", caracteres: query.trim().length });
    onSelectPoint(point);
    setQuery(point.name);
    setPointSuggestions([]);
    setAddressSuggestions([]);
    setIsFocused(false);
  };

  const handleSelectAddressSuggestion = (address: AddressResult) => {
    // Mesma regra do caso acima: só tipo e tamanho, nunca o endereço buscado.
    track("busca_realizada", { tipo: "endereco", caracteres: query.trim().length });
    // Address results only center/zoom the map — no ponto detail screen exists for them.
    onSelectAddress(address);
    setQuery(address.label);
    setPointSuggestions([]);
    setAddressSuggestions([]);
    setIsFocused(false);
  };

  const handleClear = () => {
    setQuery("");
    setPointSuggestions([]);
    setAddressSuggestions([]);
  };

  const hasResults = pointSuggestions.length > 0 || addressSuggestions.length > 0;

  return (
    <div ref={containerRef} className="absolute top-[calc(env(safe-area-inset-top)+16px)] left-4 right-4 md:left-6 md:right-6 z-50 xl:top-4 xl:left-4 xl:right-auto xl:w-[380px] xl:max-w-none">
      {/* Taller input container (h-14) for better accessibility */}
      <div className="relative flex items-center bg-white border border-gray-150 shadow-lg rounded-full px-5 py-2 h-14 transition-all duration-200 focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/10">
        {/* Search Icon - larger (w-5.5) */}
        <Search className="w-5.5 h-5.5 text-text-secondary mr-3 flex-shrink-0" />

        {/* Text Input - larger font (text-base) */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          placeholder="Buscar ponto turístico ou endereço..."
          className="w-full bg-transparent text-text-main placeholder-text-secondary font-semibold text-base focus:outline-none h-full"
        />

        {/* Clear Button - larger touch target */}
        {query && (
          <button
            onClick={handleClear}
            className="p-2 mr-1 hover:bg-gray-100 rounded-full text-text-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* QR Code Action Button - larger (w-11 h-11) */}
        <div className="h-7 w-[1.5px] bg-gray-200 mr-3 flex-shrink-0" />
        <button
          onClick={onOpenScanner}
          className="flex items-center justify-center w-11 h-11 rounded-full text-brand bg-brand-light hover:bg-brand hover:text-white transition-colors duration-200 flex-shrink-0 active:scale-95 shadow-sm"
          title="Escanear QR Code"
        >
          <QrCode className="w-5.5 h-5.5 stroke-[2.2]" />
        </button>
      </div>

      {/* Grouped Suggestion Dropdown — "Pontos da Rota" and "Endereços" */}
      <AnimatePresence>
        {isFocused && (hasResults || isLoadingAddresses) && (
          <motion.div
            initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            className="absolute left-0 right-0 mt-2 bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden z-50 max-h-80 overflow-y-auto"
          >
            {pointSuggestions.length > 0 && (
              <div>
                <span className="block px-5 pt-3 pb-1.5 text-[10px] font-black uppercase tracking-widest text-brand bg-brand-light/30">
                  Pontos da Rota
                </span>
                <ul>
                  {pointSuggestions.map((point) => (
                    <li key={point.id}>
                      <button
                        onClick={() => handleSelectPointSuggestion(point)}
                        className="w-full text-left px-5 py-4 hover:bg-brand-light/30 flex items-center gap-3 border-b border-gray-50 transition-colors"
                      >
                        <Landmark className="w-4 h-4 text-brand flex-shrink-0" />
                        <div className="flex-1">
                          <h4 className="font-bold text-base text-text-main">{point.name}</h4>
                          <p className="text-xs text-text-secondary mt-1 font-semibold">{point.category}</p>
                        </div>
                        <span className="text-xs text-brand bg-brand-light px-3 py-1 rounded-full font-bold flex-shrink-0">
                          Ver no mapa
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(addressSuggestions.length > 0 || isLoadingAddresses) && (
              <div>
                <span className="block px-5 pt-3 pb-1.5 text-[10px] font-black uppercase tracking-widest text-text-secondary bg-gray-50">
                  Endereços
                </span>
                {isLoadingAddresses && addressSuggestions.length === 0 && (
                  <p className="px-5 py-4 text-sm text-text-secondary font-semibold">Buscando endereços...</p>
                )}
                <ul>
                  {addressSuggestions.map((address) => (
                    <li key={address.id}>
                      <button
                        onClick={() => handleSelectAddressSuggestion(address)}
                        className="w-full text-left px-5 py-4 hover:bg-gray-50 flex items-center gap-3 border-b border-gray-50 last:border-b-0 transition-colors"
                      >
                        <MapPin className="w-4 h-4 text-text-secondary flex-shrink-0" />
                        <span className="flex-1 text-sm text-text-main font-semibold leading-snug">{address.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
