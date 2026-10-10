"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface RatingModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit: (rating: number, feedback?: string) => void;
}

/**
 * Modal avaliação site — estrelas + feedback opcional.
 *
 * Acessibilidade (mesmo padrão OutOfAreaNotice):
 *  - role="dialog" + aria-modal + foco trap
 *  - Esc fecha
 *  - Foco volta pro elemento anterior
 *  - aria-hidden em ícones decorativos
 *  - Respeita reduce_motion
 *
 * Visual: clean, igual outros modals projeto (card branco, rounded-3xl, laranja marca).
 */
export default function RatingModal({ open, onDismiss, onSubmit }: RatingModalProps) {
  const { preferences } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;

  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>("");

  // Foco: guarda elemento anterior, move pra dialog, devolve ao fechar
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

  // Esc fecha; Tab fica preso
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
        'button, a[href], textarea, [tabindex]:not([tabindex="-1"])'
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

  // Reset state ao fechar
  useEffect(() => {
    if (!open) {
      setSelectedRating(0);
      setHoverRating(0);
      setFeedback("");
    }
  }, [open]);

  const handleSubmit = () => {
    if (selectedRating === 0) return;
    onSubmit(selectedRating, feedback.trim() || undefined);
    onDismiss();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
          {/* Fundo escurecido: clicar fecha */}
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
            aria-labelledby="rating-titulo"
            aria-describedby="rating-descricao"
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
              aria-label="Fechar avaliação"
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-gray-100 text-text-secondary hover:bg-gray-200 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4.5 h-4.5" aria-hidden="true" />
            </button>

            <span className="w-14 h-14 rounded-2xl bg-brand-light text-brand flex items-center justify-center">
              <Star className="w-7 h-7" aria-hidden="true" />
            </span>

            <h2
              id="rating-titulo"
              className="mt-4 pr-12 text-xl font-black text-text-main leading-snug"
            >
              O que achou do site?
            </h2>

            <p
              id="rating-descricao"
              className="mt-2.5 text-sm text-text-secondary font-medium leading-relaxed"
            >
              Sua avaliação nos ajuda a melhorar a experiência de todos.
            </p>

            {/* Estrelas */}
            <div className="mt-6 flex gap-2 justify-center" role="group" aria-label="Avaliação em estrelas">
              {[1, 2, 3, 4, 5].map((star) => {
                const filled = star <= (hoverRating || selectedRating);
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setSelectedRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`${star} ${star === 1 ? "estrela" : "estrelas"}`}
                    className="transition-transform hover:scale-110 cursor-pointer"
                  >
                    <Star
                      className={`w-10 h-10 transition-colors ${
                        filled ? "fill-brand text-brand" : "fill-transparent text-gray-300"
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>

            {/* Feedback opcional */}
            <div className="mt-6">
              <label htmlFor="rating-feedback" className="block text-sm font-bold text-text-main mb-2">
                Comentário (opcional)
              </label>
              <textarea
                id="rating-feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Conte-nos mais sobre sua experiência..."
                maxLength={500}
                rows={3}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-text-main placeholder:text-text-secondary resize-none focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
              />
              <p className="mt-1 text-xs text-text-secondary text-right">{feedback.length}/500</p>
            </div>

            {/* Botões */}
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={selectedRating === 0}
                className="w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white font-bold text-sm rounded-full py-3.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Enviar avaliação
              </button>

              <button
                type="button"
                onClick={onDismiss}
                className="w-full rounded-full py-3.5 text-sm font-bold text-text-main bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                Agora não
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
