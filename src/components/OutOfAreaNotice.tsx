"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Navigation, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface OutOfAreaNoticeProps {
  open: boolean;
  /** Nome da cidade detectada, quando o geocodificador soube dizer. */
  detectedCity: string | null;
  /** Fecha e continua navegando (não volta a aparecer na mesma sessão). */
  onDismiss: () => void;
  /** Leva o usuário para a área atendida (centraliza o mapa em Governador
   * Valadares) — reaproveita o mesmo fly-to que o botão de recentralizar usa. */
  onGoToCoverage: () => void;
}

/**
 * Aviso para quem está fora de Governador Valadares.
 *
 * Decisões de acessibilidade (o aviso não pode ser uma armadilha):
 *  - `role="dialog"` + `aria-modal` + rótulo/descrição ligados por id.
 *  - O foco vai para o diálogo ao abrir, fica preso nele enquanto está aberto
 *    (Tab cicla) e volta para o elemento anterior ao fechar (WCAG 2.1.2/2.4.3).
 *  - `Esc` e o fundo fecham, e fechar significa continuar usando o website —
 *    nunca bloqueia a navegação.
 *  - `aria-hidden` nos ícones decorativos; nenhum texto depende só de cor.
 *  - Respeita reduzir movimento (preferência do usuário e do sistema).
 *
 * Visual: mesmos tokens do resto do website (card branco, `rounded-3xl`,
 * laranja da marca, tipografia `font-black`/`font-bold`), sem gradiente,
 * emoji ou decoração — igual aos outros sheets do projeto.
 */
export default function OutOfAreaNotice({
  open,
  detectedCity,
  onDismiss,
  onGoToCoverage,
}: OutOfAreaNoticeProps) {
  const { preferences } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;

  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Foco: guarda o elemento anterior, move para o diálogo e devolve ao fechar.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const firstButton = panel?.querySelector<HTMLElement>("button, a[href]");
    (firstButton ?? panel)?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Esc fecha; Tab fica preso dentro do diálogo.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onDismiss]);

  return (
    <AnimatePresence>
      {open && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
          {/* Fundo escurecido: clicar fecha (mesma ação do botão "Continuar"). */}
          <motion.div
            initial={reduceMotion ? { opacity: 0.45 } : { opacity: 0 }}
            animate={{ opacity: 0.45 }}
            exit={reduceMotion ? { opacity: 0.45 } : { opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
            onClick={onDismiss}
            className="absolute inset-0 bg-black"
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fora-de-area-titulo"
            aria-describedby="fora-de-area-descricao"
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 26, stiffness: 300 }}
            className="relative w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto no-scrollbar bg-white rounded-3xl border border-gray-100 shadow-2xl p-6 sm:p-7 outline-none"
          >
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Fechar aviso e continuar no website"
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-gray-100 text-text-secondary hover:bg-gray-200 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4.5 h-4.5" aria-hidden="true" />
            </button>

            <span className="w-14 h-14 rounded-2xl bg-brand-light text-brand flex items-center justify-center">
              <MapPin className="w-7 h-7" aria-hidden="true" />
            </span>

            <h2
              id="fora-de-area-titulo"
              className="mt-4 pr-12 text-xl font-black text-text-main leading-snug"
            >
              Por enquanto, só Governador Valadares
            </h2>

            <p
              id="fora-de-area-descricao"
              className="mt-2.5 text-sm text-text-secondary font-medium leading-relaxed"
            >
              {detectedCity
                ? `Você está em ${detectedCity}. Todos os pontos do mapa ficam em Governador Valadares (MG).`
                : "Você está fora da área atendida. Todos os pontos do mapa ficam em Governador Valadares (MG)."}
            </p>

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onGoToCoverage}
                className="w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white font-bold text-sm rounded-full py-3.5 transition-colors cursor-pointer"
              >
                <Navigation className="w-4 h-4" aria-hidden="true" />
                Ver o mapa de Governador Valadares
              </button>

              <button
                type="button"
                onClick={onDismiss}
                className="w-full rounded-full py-3.5 text-sm font-bold text-text-main bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                Continuar onde estou
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
