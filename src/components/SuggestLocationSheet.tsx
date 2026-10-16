"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, MapPin, MapPinPlus, Check, Loader2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { searchAddresses, AddressResult } from "@/services/geocodingService";
import { suggestLocal } from "@/services/suggestionsService";
import { checkExistingPlace } from "@/services/communityPointsService";
import type { ExistingPlaceMatch } from "@/types/database";

interface SuggestLocationSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Já existe um ponto (oficial ou em mapeamento) no mesmo lugar: abrir esse ponto. */
  onOpenExistingPoint: (pontoId: string) => void;
}

// Same debounce delay used by SearchBar for Photon requests.
const PHOTON_DEBOUNCE_MS = 400;

/**
 * "Sugerir um local" — bottom sheet on mobile, byte-for-byte matching
 * BottomSheet.tsx's point-preview shell/backdrop/spring/z-index (must be
 * mounted inside the map's relative container in page.tsx, same as
 * BottomSheet, so "absolute bottom-0" resolves against that container —
 * which ends where BottomNav begins — landing on top of the nav bar
 * without covering it). Fixed side panel on desktop (xl:, consistent with
 * the other xl: side sheets in the app).
 */
export default function SuggestLocationSheet({ isOpen, onClose, onOpenExistingPoint }: SuggestLocationSheetProps) {
  const { preferences, isAnonymous } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;

  const [nome, setNome] = useState("");
  const [enderecoQuery, setEnderecoQuery] = useState("");
  const [selectedAddress, setSelectedAddress] = useState<AddressResult | null>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressResult[]>([]);
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false);
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [status, setStatus] = useState<"idle" | "checking" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  // Pré-checagem de duplicidade: ponto já existente no mesmo lugar.
  const [existingMatch, setExistingMatch] = useState<ExistingPlaceMatch | null>(null);
  const [ignorarDuplicata, setIgnorarDuplicata] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced Photon geocoding — identical pattern to SearchBar.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (enderecoQuery.trim().length < 3) {
      setAddressSuggestions([]);
      setIsLoadingAddresses(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoadingAddresses(true);
      searchAddresses(enderecoQuery, controller.signal)
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
  }, [enderecoQuery]);

  // Close address suggestion dropdown on outside click.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsAddressFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const resetForm = () => {
    setNome("");
    setEnderecoQuery("");
    setSelectedAddress(null);
    setAddressSuggestions([]);
    setStatus("idle");
    setError("");
    setExistingMatch(null);
    setIgnorarDuplicata(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSelectAddress = (address: AddressResult) => {
    // Coordinate capture happens here, automatically — the user never types
    // or sees lat/lng, they only pick a result from the Photon suggestions.
    setSelectedAddress(address);
    setEnderecoQuery(address.label);
    setAddressSuggestions([]);
    setIsAddressFocused(false);
  };

  const handleEnderecoChange = (value: string) => {
    setEnderecoQuery(value);
    // Typing again after having picked a result invalidates the captured
    // coordinate — force the user to pick a fresh suggestion before submit.
    if (selectedAddress) setSelectedAddress(null);
  };

  const canSubmit =
    nome.trim().length > 0 && selectedAddress !== null && status !== "sending" && status !== "checking";

  const handleSubmit = async (skipCheck = false) => {
    if (!canSubmit || !selectedAddress) return;

    // Antes de enviar: já existe um ponto (oficial ou em mapeamento) no mesmo
    // lugar e com nome parecido? Se a checagem falhar, o envio segue normal.
    if (!skipCheck && !ignorarDuplicata) {
      setStatus("checking");
      setError("");
      try {
        const matches = await checkExistingPlace(nome.trim(), selectedAddress.lat, selectedAddress.lng);
        if (matches.length > 0) {
          setExistingMatch(matches[0]);
          setStatus("idle");
          return;
        }
      } catch (e) {
        if (process.env.NODE_ENV !== "production") console.warn("[sugestao] pré-checagem falhou", e);
      }
      setStatus("idle");
    }

    if (isAnonymous) {
      setError("Entre na sua conta para sugerir um local.");
      setStatus("error");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      await suggestLocal({
        nome: nome.trim(),
        endereco: selectedAddress.label,
        latitude: selectedAddress.lat,
        longitude: selectedAddress.lng,
      });
      setStatus("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar. Tente novamente.");
      setStatus("error");
    }
  };

  // Shared form body — used inside both the mobile bottom sheet and the
  // desktop side panel, so the two layouts never drift out of sync. Field
  // sizes/spacing/button styling mirror BottomSheet.tsx's point-preview
  // sheet (same input height, same pill CTA button) for design consistency.
  const formBody = (
    <>
      <p className="text-sm text-text-secondary mt-3 leading-relaxed font-semibold">
        Conhece um local acessível que ainda não está no mapa? Envie sua sugestão.
      </p>

      {existingMatch && status !== "sent" ? (
        <div role="status" aria-live="polite" className="mt-6 bg-white rounded-3xl p-6 border border-gray-200 flex flex-col gap-3">
          <p className="text-base font-black text-text-main">Este local já está no mapa</p>
          <p className="text-base font-semibold text-text-main">{existingMatch.nome}</p>
          <p className="text-sm font-semibold text-text-secondary">
            {existingMatch.status === "oficial" ? "Ponto oficial" : "Em mapeamento"} · a {existingMatch.distancia_m} m
          </p>
          <button
            type="button"
            onClick={() => {
              const id = existingMatch.ponto_id;
              handleClose();
              onOpenExistingPoint(id);
            }}
            className="mt-2 w-full flex items-center justify-center gap-2.5 bg-brand hover:bg-brand-dark text-white font-extrabold text-base tracking-wider uppercase py-4.5 px-6 rounded-full shadow-md shadow-brand/10"
          >
            Ver local
          </button>
          <button
            type="button"
            onClick={() => {
              setIgnorarDuplicata(true);
              setExistingMatch(null);
              void handleSubmit(true);
            }}
            className="text-sm font-bold text-text-secondary underline underline-offset-2 py-2"
          >
            É outro local, enviar mesmo assim
          </button>
        </div>
      ) : status === "sent" ? (
        <div className="mt-6 bg-gray-50 rounded-3xl p-6 border border-gray-100 flex flex-col items-center text-center gap-3 py-8">
          <span className="w-14 h-14 rounded-full bg-brand-light text-brand flex items-center justify-center">
            <Check className="w-7 h-7 stroke-[2.5]" />
          </span>
          <p className="text-base font-bold text-text-main">Sugestão enviada, obrigado!</p>
          <p className="text-sm text-text-secondary font-medium">
            Sua indicação ajuda a priorizar os próximos cadastros.
          </p>
          <button
            onClick={handleClose}
            className="mt-2 text-sm font-bold text-brand underline underline-offset-2"
          >
            Fechar
          </button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          {/* Nome do local */}
          <div>
            <label htmlFor="sugestao-nome" className="text-xs font-extrabold uppercase tracking-wider text-text-secondary">
              Nome do local
            </label>
            <input
              id="sugestao-nome"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={120}
              placeholder="Ex: Praça da Estação"
              className="w-full mt-2 h-14 rounded-2xl border border-gray-150 bg-white px-4 text-base font-semibold text-text-main placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/50"
            />
          </div>

          {/* Endereço — Photon autocomplete, coordinate captured on select */}
          <div className="relative">
            <label htmlFor="sugestao-endereco" className="text-xs font-extrabold uppercase tracking-wider text-text-secondary">
              Endereço
            </label>
            <input
              id="sugestao-endereco"
              type="text"
              value={enderecoQuery}
              onChange={(e) => handleEnderecoChange(e.target.value)}
              onFocus={() => setIsAddressFocused(true)}
              placeholder="Digite para buscar o endereço..."
              className="w-full mt-2 h-14 rounded-2xl border border-gray-150 bg-white px-4 text-base font-semibold text-text-main placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/50"
            />
            {selectedAddress && (
              <p className="mt-2 text-xs font-bold text-brand flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                Localização capturada
              </p>
            )}

            <AnimatePresence>
              {isAddressFocused && (addressSuggestions.length > 0 || isLoadingAddresses) && (
                <motion.div
                  initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: reduceMotion ? 0 : 0.15 }}
                  className="absolute left-0 right-0 mt-2 bg-white rounded-2xl border border-gray-100 shadow-xl overflow-hidden z-50 max-h-64 overflow-y-auto"
                >
                  {isLoadingAddresses && addressSuggestions.length === 0 && (
                    <p className="px-5 py-4 text-sm text-text-secondary font-semibold">Buscando endereços...</p>
                  )}
                  <ul>
                    {addressSuggestions.map((address) => (
                      <li key={address.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectAddress(address)}
                          className="w-full text-left px-5 py-4 hover:bg-gray-50 flex items-center gap-3 border-b border-gray-50 last:border-b-0 transition-colors"
                        >
                          <MapPin className="w-4 h-4 text-text-secondary flex-shrink-0" />
                          <span className="flex-1 text-sm text-text-main font-semibold leading-snug">{address.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {status === "error" && (
            <p className="text-sm font-bold text-brand">{error}</p>
          )}

          <div className="mt-2 flex items-center justify-between gap-4">
            <button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="flex-1 flex items-center justify-center gap-2.5 bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-base tracking-wider uppercase py-4.5 px-6 rounded-full transition-all duration-200 active:scale-95 shadow-md shadow-brand/10"
            >
              {status === "sending" || status === "checking" ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {status === "checking" ? "Verificando..." : "Enviando..."}
                </>
              ) : (
                "Enviar Sugestão"
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div ref={containerRef}>
          {/* Backdrop — mobile/tablet only, z-30 same as BottomSheet.tsx */}
          <motion.div
            initial={reduceMotion ? { opacity: 0.3 } : { opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={reduceMotion ? { opacity: 0.3 } : { opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : undefined}
            onClick={handleClose}
            className="absolute inset-0 bg-black z-30 pointer-events-auto xl:hidden"
          />

          {/* Mobile/tablet: bottom sheet — z-40 same as BottomSheet.tsx, so
              it sits above BottomNav (z-40, but painted first) without
              extending past it — "bottom-0" resolves against the map's
              relative container, which stops right where BottomNav starts. */}
          <motion.div
            initial={reduceMotion ? { y: 0 } : { y: "100%" }}
            animate={{ y: 0 }}
            exit={reduceMotion ? { y: 0 } : { y: "100%" }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 25, stiffness: 220 }}
            className="absolute bottom-0 left-0 right-0 z-40 bg-white rounded-t-[32px] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] border-t border-gray-100 w-full overflow-hidden pb-8 xl:hidden"
          >
            {/* Handle Bar */}
            <div className="flex justify-center py-4">
              <div className="w-16 h-2 bg-gray-200 rounded-full" />
            </div>

            <div className="px-6 md:px-10">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <span className="text-[11px] uppercase font-extrabold tracking-widest text-brand bg-brand-light px-3 py-1.5 rounded-full">
                    Comunidade
                  </span>
                  <h3 className="text-2xl font-extrabold text-text-main mt-3 leading-tight flex items-center gap-2.5">
                    <MapPinPlus className="w-6 h-6 text-brand" />
                    Sugerir um Local
                  </h3>
                </div>
                <button
                  onClick={handleClose}
                  className="p-2.5 bg-gray-50 hover:bg-gray-100 rounded-full text-text-secondary transition-colors active:scale-95 flex-shrink-0"
                  aria-label="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {formBody}
            </div>
          </motion.div>

          {/* Desktop: fixed side panel, consistent with the app's other xl: side sheets */}
          <motion.div
            initial={reduceMotion ? { x: 0 } : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduceMotion ? { x: 0 } : { x: "100%" }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 30, stiffness: 300 }}
            className="hidden xl:flex xl:fixed xl:right-0 xl:top-0 xl:bottom-0 xl:z-[70] xl:w-[380px] xl:flex-col xl:overflow-hidden xl:bg-bg-app xl:text-text-main xl:border-l xl:border-gray-200 xl:shadow-2xl pointer-events-auto"
          >
            <div className="px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-4 flex items-center gap-4 border-b border-gray-100 bg-white/80 backdrop-blur-md flex-shrink-0">
              <button
                onClick={handleClose}
                className="p-2.5 rounded-full bg-gray-100 text-text-main hover:bg-gray-200 transition-all active:scale-95 cursor-pointer"
                aria-label="Voltar"
              >
                <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
              </button>
              <h1 className="font-black text-lg leading-tight flex items-center gap-2">
                <MapPinPlus className="w-5 h-5 text-brand" />
                Sugerir um Local
              </h1>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar p-6 pb-10 flex flex-col gap-5">{formBody}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
