"use client";

import React from "react";
import Link from "next/link";
import { motion, PanInfo } from "framer-motion";
import { Compass, ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import type { TouristPoint } from "@/types/point";

interface ExploreBottomSheetProps {
  currentState: "collapsed" | "expanded";
  setCurrentState: (state: "collapsed" | "expanded") => void;
  hideOnDesktop?: boolean;
  /** Pontos reais do cadastro — a lista textual equivalente ao mapa. */
  points: TouristPoint[];
  onSelectPoint: (point: TouristPoint) => void;
}

/**
 * Lista textual dos pontos, equivalente ao mapa.
 *
 * MOTIVO DA REESCRITA (auditoria, item A1/A7/C5): antes este painel mostrava
 * três cards fixos escritos à mão, que (1) não eram os pontos do banco, (2) não
 * eram acessíveis por teclado (`div` com cursor-pointer) e (3) afirmavam
 * "acessibilidade física verificada" — coisa que a validação em campo da ONG
 * UAI ainda não confirmou. Agora é uma `<ul>` de botões reais, com o mesmo
 * conteúdo do mapa, e sem afirmar validação.
 */
export default function ExploreBottomSheet({
  currentState,
  setCurrentState,
  hideOnDesktop,
  points,
  onSelectPoint,
}: ExploreBottomSheetProps) {
  const { preferences } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    // Dragging up (negative y offset/velocity) expands the sheet
    if (info.offset.y < -60 || info.velocity.y < -150) {
      setCurrentState("expanded");
    }
    // Dragging down collapses the sheet
    else if (info.offset.y > 60 || info.velocity.y > 150) {
      setCurrentState("collapsed");
    }
  };

  const isExpanded = currentState === "expanded";
  const toggleState = () => setCurrentState(isExpanded ? "collapsed" : "expanded");

  const variants = {
    initial: {
      y: "100%",
      opacity: 0,
    },
    collapsed: {
      bottom: "calc(env(safe-area-inset-bottom) + 84px)",
      height: "90px",
      y: 0,
      opacity: 1,
      zIndex: 30,
    },
    expanded: {
      bottom: "calc(env(safe-area-inset-bottom) + 84px)",
      height: "58dvh",
      y: 0,
      opacity: 1,
      zIndex: 30,
    },
    exit: {
      y: "100%",
      opacity: 0,
      transition: { duration: reduceMotion ? 0 : 0.25 },
    },
  };

  return (
    <motion.section
      aria-label="Lista de pontos turísticos"
      drag={reduceMotion ? false : "y"}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.15}
      onDragEnd={handleDragEnd}
      initial="initial"
      animate={currentState}
      exit="exit"
      variants={variants}
      className={`absolute bottom-0 left-0 right-0 bg-white border-t border-gray-150 rounded-t-[32px] shadow-[0_-12px_32px_rgba(0,0,0,0.08)] flex flex-col overflow-hidden md:max-w-xl md:mx-auto md:rounded-t-[32px] xl:bottom-6 xl:left-4 xl:right-auto xl:w-[380px] xl:rounded-3xl xl:shadow-2xl xl:border${hideOnDesktop ? " xl:hidden" : ""}`}
      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 28 }}
    >
      {/* Cabeçalho: botão de verdade, com estado anunciado */}
      <button
        type="button"
        onClick={toggleState}
        aria-expanded={isExpanded}
        aria-controls="lista-pontos"
        className="w-full flex flex-col items-center pt-3 pb-4 hover:bg-gray-50/50 transition-colors flex-shrink-0 cursor-pointer"
      >
        <div className="w-10 h-1.5 bg-gray-200 rounded-full mb-3" aria-hidden="true" />
        <div className="px-6 w-full flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 min-w-0">
            <Compass className="w-5.5 h-5.5 text-brand flex-shrink-0" aria-hidden="true" />
            <span className="font-extrabold text-base text-text-main tracking-tight truncate">
              Pontos em Governador Valadares
            </span>
          </span>
          <span className="flex items-center gap-1.5 flex-shrink-0 text-xs font-black text-brand">
            {points.length}
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            )}
          </span>
        </div>
      </button>

      {/* Conteúdo (rolável) */}
      <div id="lista-pontos" className="flex-1 overflow-y-auto px-6 pb-12 no-scrollbar">
        {points.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary font-medium leading-relaxed">
            Carregando os pontos cadastrados...
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5 mt-1">
            {points.map((point) => (
              <li key={point.id}>
                <button
                  type="button"
                  onClick={() => onSelectPoint(point)}
                  className="w-full text-left bg-white border border-gray-150 rounded-2xl p-4 flex gap-3.5 items-center shadow-sm hover:border-brand/35 transition-colors cursor-pointer"
                >
                  <span className="w-11 h-11 rounded-xl bg-brand-light flex items-center justify-center text-brand flex-shrink-0">
                    <MapPin className="w-5.5 h-5.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex flex-col">
                    <span className="font-bold text-sm text-text-main truncate">{point.name}</span>
                    <span className="text-xs text-text-secondary font-medium truncate mt-0.5">
                      {[point.category, point.city].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-5 text-xs text-text-secondary font-medium leading-relaxed">
          As informações de acessibilidade de cada local vêm do cadastro e estão em validação em
          campo pela ONG UAI.{" "}
          <Link href="/pontos" className="font-bold text-brand underline hover:text-brand-dark">
            Ver todos em páginas de texto
          </Link>
        </p>
      </div>
    </motion.section>
  );
}
