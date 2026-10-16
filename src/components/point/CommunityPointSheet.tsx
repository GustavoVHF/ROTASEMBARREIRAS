"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, Loader2, Pause, Play, X } from "lucide-react";
import type { TouristPoint } from "@/types/point";
import type { ConsensoRecursoRow, RelatoRecursos, RelatoWithProfile } from "@/types/database";
import { useAuth } from "@/context/AuthContext";
import { useSpeechReader, type SpeechSegment } from "@/hooks/useSpeechReader";
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

const NOTICE_TEXT = "Informações da comunidade, ainda sem dados oficiais de acessibilidade.";
const VISIBLE_RELATOS = 5;

interface CommunityPointSheetProps {
  point: TouristPoint;
  onClose: () => void;
  voiceActive: boolean;
}

/**
 * Tela de um ponto "Em mapeamento" (OpenStreetMap / comunidade).
 * Celular: bottom sheet; desktop (xl): painel lateral à esquerda, no mesmo
 * lugar do PointDetails. Só o essencial: nome, o aviso de uma linha, o
 * formulário de relato e as condições recentes — sem endereço, sem dados do
 * OpenStreetMap. A tela dos pontos oficiais continua sendo o PointDetails.
 */
export default function CommunityPointSheet({ point, onClose, voiceActive }: CommunityPointSheetProps) {
  const titleId = useId();
  const noteId = useId();
  const textId = useId();
  const counterId = useId();
  const errorId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  const { preferences, isAnonymous } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;
  const reader = useSpeechReader();

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1280);
    check();
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
    // Sem bloqueio de login: sessões anônimas também enviam relatos.
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
      // Medição: só o id, o tipo e o TAMANHO do texto — nunca o conteúdo.
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

  // --- Teclado e foco ---
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // --- Voz alta ---
  const resumo = consensoResumo(consensus);
  const count = relatos?.length ?? 0;
  const summaryText =
    relatos === null
      ? ""
      : count > 0
        ? `${count} ${count === 1 ? "relato" : "relatos"} nos últimos ${CONDITION_WINDOW_DAYS} dias`
        : "Sem relatos recentes. Você pode ser o primeiro a avaliar este local.";

  const segments: SpeechSegment[] = [
    { id: "name", text: point.name },
    { id: "mapping", text: "Em mapeamento" },
    { id: "notice", text: NOTICE_TEXT },
    { id: "conditions", text: [summaryText, resumo ?? ""].filter(Boolean).join(". ") },
  ].filter((s) => s.text.trim());

  const handleToggleRead = () => {
    if (reader.status === "idle") reader.play(segments);
    else if (reader.status === "playing") reader.pause();
    else reader.resume();
  };

  useEffect(() => {
    if (!voiceActive) reader.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActive]);

  useEffect(() => {
    return () => reader.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Animação (sem mola nem deslocamento com "reduzir movimento") ---
  const hidden = isDesktop ? { x: "-100%" } : { y: "100%" };
  const shown = isDesktop ? { x: 0 } : { y: 0 };
  const transition = reduceMotion ? { duration: 0 } : { type: "spring" as const, damping: 28, stiffness: 220 };

  const visibleRelatos = relatos ? (showAll ? relatos : relatos.slice(0, VISIBLE_RELATOS)) : [];

  return (
    <>
      <motion.div
        initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
        transition={reduceMotion ? { duration: 0 } : undefined}
        onClick={onClose}
        aria-hidden="true"
        className="absolute inset-0 z-[64] bg-black/30 xl:hidden"
      />
      <motion.div
        ref={sheetRef}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={noteId}
        tabIndex={-1}
        initial={reduceMotion ? shown : hidden}
        animate={shown}
        exit={reduceMotion ? shown : hidden}
        transition={transition}
        className="absolute z-[65] inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto overscroll-contain no-scrollbar bg-white rounded-t-[32px] border-t border-gray-100 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] pb-[calc(env(safe-area-inset-bottom)+24px)] focus:outline-none xl:inset-x-auto xl:left-0 xl:top-0 xl:bottom-0 xl:w-[390px] xl:max-h-none xl:h-full xl:rounded-none xl:border-t-0 xl:border-r xl:border-gray-200 xl:shadow-2xl xl:bg-bg-app xl:pt-6"
      >
        {/* Alça (decorativa) */}
        <div className="flex justify-center py-4 xl:hidden" aria-hidden="true">
          <div className="w-16 h-2 bg-gray-200 rounded-full" />
        </div>

        <div className="px-6 flex flex-col gap-8">
          {/* Cabeçalho */}
          <div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase font-extrabold tracking-widest text-brand">{point.category}</p>
                <h2 id={titleId} className="text-2xl font-black text-text-main leading-tight mt-2 break-words">
                  {point.name}
                </h2>
                <p className="text-sm font-bold text-text-secondary mt-1">Em mapeamento</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {voiceActive && (
                  <button
                    type="button"
                    onClick={handleToggleRead}
                    aria-label={reader.status === "playing" ? "Pausar leitura" : "Ouvir"}
                    className="w-11 h-11 rounded-full bg-brand-light text-brand flex items-center justify-center"
                  >
                    {reader.status === "playing" ? (
                      <Pause className="w-5 h-5" aria-hidden="true" />
                    ) : (
                      <Play className="w-5 h-5" aria-hidden="true" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar"
                  className="w-12 h-12 rounded-full bg-gray-50 hover:bg-gray-100 text-text-secondary flex items-center justify-center"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <p id={noteId} role="note" className="text-sm font-semibold text-text-secondary leading-relaxed mt-4">
              {NOTICE_TEXT}
            </p>
          </div>

          {/* Relato */}
          <section aria-labelledby={`${titleId}-relato`}>
            <h3 id={`${titleId}-relato`} className="text-lg font-black text-text-main mb-4">
              Como está este local agora?
            </h3>

            {status === "sent" ? (
              <div role="status" className="flex flex-col items-start gap-3">
                <p className="text-base font-bold text-text-main flex items-center gap-2">
                  <Check className="w-5 h-5 text-brand flex-shrink-0" aria-hidden="true" />
                  Obrigado! Seu relato ajuda a comunidade.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5 mb-5">
                  <button
                    type="button"
                    aria-pressed={tipo === "ok"}
                    onClick={() => setTipo("ok")}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl px-4 py-4 border font-bold text-sm ${
                      tipo === "ok"
                        ? "bg-brand text-white border-brand"
                        : "bg-white text-text-main border-gray-200 hover:border-brand/40"
                    }`}
                  >
                    <Check className="w-6 h-6" strokeWidth={2.5} aria-hidden="true" />
                    <span className="leading-snug">Está tudo bem</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={tipo === "problema"}
                    onClick={() => setTipo("problema")}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl px-4 py-4 border font-bold text-sm ${
                      tipo === "problema"
                        ? "bg-brand text-white border-brand"
                        : "bg-white text-text-main border-gray-200 hover:border-brand/40"
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
                  <p id={errorId} role="alert" className="text-sm font-bold text-text-main mb-3 flex items-start gap-2">
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
                    className="flex-1 flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-full min-h-12 py-3.5"
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
                    className="px-4 min-h-12 py-3.5 rounded-full text-sm font-bold text-text-secondary hover:bg-gray-100"
                  >
                    Limpar
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Condições recentes */}
          <section aria-labelledby={`${titleId}-condicoes`}>
            <h3 id={`${titleId}-condicoes`} className="text-lg font-black text-text-main mb-2">
              Condições recentes
            </h3>
            {relatos === null ? (
              <p className="text-sm font-semibold text-text-secondary flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Carregando relatos...
              </p>
            ) : (
              <>
                <p className="text-sm font-semibold text-text-secondary">{summaryText}</p>
                {resumo && <p className="text-sm font-semibold text-text-secondary mt-1">{resumo}</p>}
                {visibleRelatos.length > 0 && (
                  <ul className="mt-4">
                    {visibleRelatos.map((r) => {
                      const recursosTexto = recursosResumo(r.recursos);
                      const comentario = r.texto?.trim();
                      return (
                        <li key={r.id} className="py-3 border-t border-gray-100 flex items-start gap-3">
                          {r.tipo === "ok" ? (
                            <Check className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" aria-hidden="true" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" aria-hidden="true" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-text-main">
                              {r.tipo === "ok" ? "Está tudo bem" : "Problema relatado"}
                              <span className="font-semibold text-text-secondary"> · {relativeDayLabel(r.criado_em)}</span>
                            </p>
                            {comentario && (
                              <p className="text-sm font-semibold text-text-main leading-relaxed mt-0.5 break-words">
                                {comentario}
                              </p>
                            )}
                            {recursosTexto && (
                              <p className="text-sm font-semibold text-text-secondary mt-0.5">{recursosTexto}</p>
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
                    className="mt-2 min-h-11 text-sm font-bold text-text-secondary underline underline-offset-2"
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
