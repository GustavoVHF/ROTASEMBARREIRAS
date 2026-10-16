"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import type { TouristPoint } from "@/types/point";
import type { ConsensoRecursoRow, RelatoRecursos, RelatoWithProfile } from "@/types/database";
import { useAuth } from "@/context/AuthContext";
import {
  CONDITION_WINDOW_DAYS,
  clearPointsCache,
  createRelato,
  fetchRelatosForPoint,
  RelatoError,
} from "@/services/pointsService";
import { fetchConsensus } from "@/services/communityPointsService";
import ReportResourcesFieldset from "@/components/point/ReportResourcesFieldset";
import { consensoResumo, recursosResumo } from "@/lib/communityResources";
import { RELATO_MAX_CHARS, validateRelatoText } from "@/lib/relatoText";
import { relativeDayLabel } from "@/lib/relativeTime";
import { track } from "@/lib/analytics";

const VISIBLE_RELATOS = 5;

interface CommunityPointSheetProps {
  point: TouristPoint;
  onClose: () => void;
  voiceActive?: boolean;
}

/**
 * Tela de um ponto "Em mapeamento" (OpenStreetMap / comunidade).
 * Celular: bottom sheet com entrada suave de baixo para cima.
 * Desktop (xl): painel lateral à esquerda (sidesheet) que preserva a visibilidade
 * total do mapa ao fundo, sem backdrop escurecedor.
 * Design alinhado estritamente ao design system da plataforma, com hierarquia clara
 * e separação visual entre formulário de relato e condições recentes.
 */
export default function CommunityPointSheet({ point, onClose }: CommunityPointSheetProps) {
  const titleId = useId();
  const textId = useId();
  const counterId = useId();
  const errorId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  const { preferences, isAnonymous } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;

  // Inicialização síncrona sem delay de useEffect para evitar descompasso na animação de entrada
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1280
  );

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1280);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // --- Condições recentes (relatos dos últimos 14 dias) + consenso ---
  const [relatos, setRelatos] = useState<RelatoWithProfile[] | null>(null);
  const [consensus, setConsensus] = useState<ConsensoRecursoRow[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRelatosForPoint(point.id).catch(() => [] as RelatoWithProfile[]), fetchConsensus(point.id)]).then(
      ([data, cons]) => {
        if (cancelled) return;
        setRelatos(data);
        setConsensus(cons);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [point.id]);

  // --- Formulário de relato ---
  const [tipo, setTipo] = useState<"ok" | "problema" | null>(null);
  const [texto, setTexto] = useState("");
  const [recursos, setRecursos] = useState<RelatoRecursos>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const resetForm = () => {
    setTipo(null);
    setTexto("");
    setRecursos({});
    setStatus("idle");
    setError("");
  };

  const handleSubmit = async () => {
    if (!tipo) return;
    const textoErro = validateRelatoText(texto);
    if (textoErro) {
      setError(textoErro);
      setStatus("error");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      await createRelato({ pontoId: point.id, tipo, texto: texto || null, recursos });
      setStatus("sent");
      track("relato_enviado", {
        ponto_id: point.id,
        tipo,
        caracteres: texto.trim().length,
        status_ponto: point.status,
      });
      clearPointsCache();
      const [data, cons] = await Promise.all([
        fetchRelatosForPoint(point.id).catch(() => null),
        fetchConsensus(point.id),
      ]);
      if (data) setRelatos(data);
      setConsensus(cons);
    } catch (e) {
      setError(e instanceof RelatoError ? e.message : "Não foi possível enviar o relato. Tente novamente.");
      setStatus("error");
    }
  };

  // --- Teclado e foco acessível sem salto visual ---
  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const resumo = consensoResumo(consensus);
  const count = relatos?.length ?? 0;
  const summaryText =
    relatos === null
      ? ""
      : count > 0
        ? `${count} ${count === 1 ? "relato" : "relatos"} nos últimos ${CONDITION_WINDOW_DAYS} dias`
        : "Sem relatos recentes. Você pode ser o primeiro a avaliar este local.";

  const visibleRelatos = relatos ? (showAll ? relatos : relatos.slice(0, VISIBLE_RELATOS)) : [];

  // Animação de entrada e saída adaptada com precisão para cada viewport
  const mobileVariants = {
    hidden: { y: "100%" },
    visible: { y: 0 },
    exit: { y: "100%" },
  };

  const desktopVariants = {
    hidden: { x: "-100%" },
    visible: { x: 0 },
    exit: { x: "-100%" },
  };

  const springTransition = reduceMotion
    ? { duration: 0 }
    : isDesktop
      ? { type: "spring" as const, damping: 28, stiffness: 220 }
      : { type: "spring" as const, damping: 25, stiffness: 220 };

  return (
    <>
      {/* Backdrop transparente/escuro APENAS no mobile para fechar no toque fora. No desktop não existe backdrop para o mapa ficar sempre visível e interativo. */}
      {!isDesktop && (
        <motion.div
          key="community-mobile-backdrop"
          initial={reduceMotion ? { opacity: 0.35 } : { opacity: 0 }}
          animate={{ opacity: 0.35 }}
          exit={reduceMotion ? { opacity: 0.35 } : { opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
          onClick={onClose}
          aria-hidden="true"
          className="fixed inset-0 z-[64] bg-black xl:hidden pointer-events-auto"
        />
      )}

      <motion.div
        ref={sheetRef}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={reduceMotion ? "visible" : "hidden"}
        animate="visible"
        exit={reduceMotion ? "visible" : "exit"}
        variants={isDesktop ? desktopVariants : mobileVariants}
        transition={springTransition}
        className="fixed z-[65] inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto overscroll-contain no-scrollbar bg-bg-app rounded-t-[32px] border-t border-gray-150 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] pb-[calc(env(safe-area-inset-bottom)+24px)] focus:outline-none pointer-events-auto xl:inset-x-auto xl:left-0 xl:top-0 xl:bottom-0 xl:right-auto xl:w-[390px] xl:max-h-none xl:h-full xl:rounded-none xl:border-t-0 xl:border-r xl:border-gray-200 xl:shadow-2xl xl:pt-6 xl:pb-8"
      >
        {/* Alça decorativa visível apenas no mobile */}
        <div className="flex justify-center py-3.5 xl:hidden" aria-hidden="true">
          <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
        </div>

        <div className="px-5 sm:px-6 flex flex-col gap-5 max-w-md md:max-w-2xl mx-auto w-full xl:max-w-none xl:px-6">
          {/* Cabeçalho com hierarquia limpa e consistente com os outros cards */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <span className="inline-block text-[11px] uppercase font-extrabold tracking-widest text-brand bg-brand-light px-3 py-1.5 rounded-full">
                {point.category}
              </span>
              <h2 id={titleId} className="text-2xl font-black text-text-main leading-tight mt-2.5 break-words">
                {point.name}
              </h2>
              <p className="text-sm font-bold text-text-secondary mt-1">Em mapeamento</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="w-10 h-10 rounded-full bg-white border border-gray-200/80 shadow-sm hover:bg-gray-50 text-text-secondary hover:text-text-main flex items-center justify-center transition-all active:scale-95 flex-shrink-0 cursor-pointer"
            >
              <X className="w-5 h-5 stroke-[2.3]" aria-hidden="true" />
            </button>
          </div>

          {/* Seção 1: Formulário de Relato (Card isolado com background branco) */}
          <section
            aria-labelledby={`${titleId}-relato`}
            className="bg-white rounded-3xl p-5 md:p-6 border border-gray-100 shadow-sm flex flex-col"
          >
            <h3 id={`${titleId}-relato`} className="text-lg font-black text-text-main mb-4">
              Como está este local agora?
            </h3>

            {status === "sent" ? (
              <div role="status" className="flex flex-col items-center text-center gap-3 py-3">
                <span className="w-12 h-12 rounded-full bg-brand-light text-brand flex items-center justify-center">
                  <Check className="w-6 h-6 stroke-[2.5]" aria-hidden="true" />
                </span>
                <p className="text-base font-bold text-text-main">
                  Obrigado! Seu relato ajuda a comunidade.
                </p>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-sm font-bold text-text-secondary underline underline-offset-2 hover:text-brand transition-colors"
                >
                  Enviar outro relato
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5 mb-5">
                  <button
                    type="button"
                    aria-pressed={tipo === "ok"}
                    onClick={() => setTipo("ok")}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl px-4 py-4 border-2 font-bold text-sm transition-all active:scale-[0.98] cursor-pointer ${
                      tipo === "ok"
                        ? "bg-brand text-white border-brand shadow-sm shadow-brand/20"
                        : "bg-white text-text-main border-gray-200 hover:border-brand/40 hover:bg-gray-50/50"
                    }`}
                  >
                    <Check className="w-6 h-6" strokeWidth={2.5} aria-hidden="true" />
                    <span className="leading-snug">Está tudo bem</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={tipo === "problema"}
                    onClick={() => setTipo("problema")}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl px-4 py-4 border-2 font-bold text-sm transition-all active:scale-[0.98] cursor-pointer ${
                      tipo === "problema"
                        ? "bg-brand text-white border-brand shadow-sm shadow-brand/20"
                        : "bg-white text-text-main border-gray-200 hover:border-brand/40 hover:bg-gray-50/50"
                    }`}
                  >
                    <AlertTriangle className="w-6 h-6" strokeWidth={2.5} aria-hidden="true" />
                    <span className="leading-snug">Encontrei um problema</span>
                  </button>
                </div>

                <ReportResourcesFieldset value={recursos} onChange={setRecursos} />

                {tipo !== null && (
                  <div className="mb-4">
                    <label htmlFor={textId} className="sr-only">
                      {tipo === "problema" ? "Descreva o problema (opcional)" : "Comentário (opcional)"}
                    </label>
                    <textarea
                      id={textId}
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      maxLength={RELATO_MAX_CHARS}
                      rows={3}
                      placeholder={tipo === "problema" ? "Descreva o problema (opcional)" : "Comentário (opcional)"}
                      aria-describedby={`${counterId}${status === "error" ? ` ${errorId}` : ""}`}
                      className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-text-main placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
                    />
                    <p id={counterId} aria-live="polite" className="text-xs text-text-secondary text-right mt-1">
                      {texto.length}/{RELATO_MAX_CHARS}
                    </p>
                  </div>
                )}

                {status === "error" && (
                  <p id={errorId} role="alert" className="text-sm font-bold text-brand mb-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{error}</span>
                  </p>
                )}

                {isAnonymous && <p className="text-xs text-text-secondary mb-3">Você pode enviar sem criar conta.</p>}

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!tipo || status === "sending"}
                    className="flex-1 flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-full min-h-12 py-3.5 transition-all shadow-md shadow-brand/10 active:scale-[0.98] cursor-pointer"
                  >
                    {status === "sending" ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Enviando...
                      </>
                    ) : (
                      "Enviar relato"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-5 min-h-12 py-3.5 rounded-full text-sm font-bold text-text-secondary hover:bg-gray-100 transition-colors active:scale-95 cursor-pointer"
                  >
                    Limpar
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Seção 2: Condições recentes (Card separado e bem destacado) */}
          <section
            aria-labelledby={`${titleId}-condicoes`}
            className="bg-white rounded-3xl p-5 md:p-6 border border-gray-100 shadow-sm flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="w-7 h-7 rounded-full bg-brand-light text-brand flex items-center justify-center flex-shrink-0">
                <Check className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
              </span>
              <h3 id={`${titleId}-condicoes`} className="text-lg font-black text-text-main">
                Condições recentes
              </h3>
            </div>

            {relatos === null ? (
              <div className="flex items-center gap-2 text-sm font-semibold text-text-secondary py-3">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Carregando relatos...
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold text-text-secondary leading-relaxed">{summaryText}</p>
                {resumo && <p className="text-sm font-semibold text-text-secondary mt-1 leading-relaxed">{resumo}</p>}

                {visibleRelatos.length > 0 && (
                  <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
                    {visibleRelatos.map((r) => {
                      const recursosTexto = recursosResumo(r.recursos);
                      const comentario = r.texto?.trim();
                      return (
                        <li key={r.id} className="py-3.5 flex items-start gap-3">
                          {r.reporter_avatar ? (
                            <img
                              src={r.reporter_avatar}
                              alt={r.reporter_name}
                              className="w-8 h-8 rounded-full object-cover border border-gray-100 shrink-0 mt-0.5"
                            />
                          ) : (
                            <span className="w-8 h-8 rounded-full bg-brand-light text-brand flex items-center justify-center font-black text-xs shrink-0 mt-0.5">
                              {r.reporter_name?.charAt(0).toUpperCase() || (r.tipo === "ok" ? "✓" : "!")}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-text-main">
                              {r.tipo === "ok" ? "Está tudo bem" : "Problema relatado"}
                              <span className="font-semibold text-text-secondary"> · {relativeDayLabel(r.criado_em)}</span>
                            </p>
                            {comentario && (
                              <p className="text-sm font-semibold text-text-main leading-relaxed mt-1 break-words">
                                {comentario}
                              </p>
                            )}
                            {recursosTexto && (
                              <p className="text-xs font-semibold text-text-secondary mt-1">{recursosTexto}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {relatos.length > VISIBLE_RELATOS && (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    aria-expanded={showAll}
                    className="mt-3 min-h-10 text-sm font-bold text-brand hover:underline underline-offset-2 self-start cursor-pointer"
                  >
                    {showAll ? "Mostrar menos" : `Mostrar todos (${relatos.length})`}
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </motion.div>
    </>
  );
}
