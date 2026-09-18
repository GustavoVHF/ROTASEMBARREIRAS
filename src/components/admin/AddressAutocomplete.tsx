"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapPin, Loader2, Check } from "lucide-react";
import { searchAddresses, AddressResult } from "@/services/geocodingService";

// Same debounce the rest of the app uses for Photon requests.
const PHOTON_DEBOUNCE_MS = 400;

interface AddressAutocompleteProps {
  /** Current address text (endereco). */
  value: string;
  /** Fires on every keystroke — coords are cleared by the parent. */
  onTextChange: (text: string) => void;
  /** Fires when a Photon result is picked: lat/lng captured automatically. */
  onSelect: (result: AddressResult) => void;
  /** Coordinates already attached to the form, if any. */
  coords: { lat: number; lng: number } | null;
  label?: string;
  required?: boolean;
}

/**
 * Photon address field. Same geocoder used by SearchBar/SuggestLocationSheet.
 *
 * The suggestion list renders IN FLOW (not absolutely positioned) on
 * purpose: this component is used inside a scrollable modal body, and an
 * absolute dropdown gets clipped by the scroll container (one of the visual
 * bugs in the previous panel). In-flow means it simply pushes content down
 * and scrolls with everything else.
 */
export default function AddressAutocomplete({
  value,
  onTextChange,
  onSelect,
  coords,
  label = "Endereço",
  required,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Keeps the request from re-firing right after a selection sets the text.
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }

    debounceRef.current = setTimeout(() => {
      // Short queries only clear the list — Photon's public instance isn't
      // meant for 1-2 char noise (see geocodingService).
      if (value.trim().length < 3) {
        abortRef.current?.abort();
        setSuggestions([]);
        setLoading(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      searchAddresses(value, controller.signal)
        .then((results) => {
          setSuggestions(results);
          setLoading(false);
        })
        .catch((err) => {
          if (err.name !== "AbortError") setLoading(false);
        });
    }, PHOTON_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSelect = (result: AddressResult) => {
    skipNextSearchRef.current = true;
    onSelect(result);
    setSuggestions([]);
    setOpen(false);
  };

  const showList = open && (loading || suggestions.length > 0);

  return (
    <div>
      <label className="text-xs font-black uppercase tracking-wider text-text-secondary">
        {label} {required && "*"}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onTextChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Digite e escolha um resultado"
        className="w-full mt-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-text-main focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
      />

      {coords && (
        <p className="mt-2 text-xs font-bold text-brand flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 stroke-[3]" />
          Coordenadas capturadas · {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
        </p>
      )}

      {showList && (
        <div className="mt-2 rounded-2xl border border-gray-100 bg-gray-50/60 overflow-hidden">
          {loading && suggestions.length === 0 && (
            <p className="px-4 py-3 text-xs text-text-secondary font-bold flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Buscando endereços...
            </p>
          )}
          <ul>
            {suggestions.map((address) => (
              <li key={address.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(address)}
                  className="w-full text-left px-4 py-3 hover:bg-white flex items-start gap-2.5 border-b border-gray-100 last:border-b-0 transition-colors"
                >
                  <MapPin className="w-4 h-4 text-text-secondary flex-shrink-0 mt-0.5" />
                  <span className="flex-1 text-sm text-text-main font-semibold leading-snug">{address.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
