"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Check,
  Trophy,
  Share2,
  ArrowLeft,
  QrCode,
  Map,
  X,
  Accessibility,
  Volume2,
  Bookmark,
  Eye,
  Sparkles,
} from "lucide-react";
import { TouristPoint } from "@/types/point";
import { useAuth } from "@/context/AuthContext";
import {
  fetchTrails,
  fetchTotalXp,
  calculateTrailProgress,
  grantBadgeIfComplete,
  Trail,
  TrailPointNode,
} from "@/services/trailsService";
import { track } from "@/lib/analytics";

interface TrailsViewProps {
  points?: TouristPoint[];
  onSelectPointFromTrail?: (point: TouristPoint) => void;
  onOpenScanner?: () => void;
  refreshKey?: number;
  /** Voice assistant deep-link: auto-opens the trail matching this city
   * name (case-insensitive substring) once trails finish loading. */
  autoOpenCity?: string | null;
}

export default function TrailsView({ points, onSelectPointFromTrail, onOpenScanner, refreshKey, autoOpenCity }: TrailsViewProps) {
  const { user, preferences } = useAuth();
  const isHighContrast = preferences?.high_contrast_enabled ?? false;
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;

  const [trails, setTrails] = useState<Trail[]>([]);
  const [activeTrail, setActiveTrail] = useState<Trail | null>(null);
  const [selectedNode, setSelectedNode] = useState<TrailPointNode | null>(null);
  const [showBadgeModal, setShowBadgeModal] = useState(false);
  const [showShareSuccess, setShowShareSuccess] = useState(false);
  const [totalXp, setTotalXp] = useState<number>(0);

  const loadTrails = useCallback(() => {
    if (!user) return;
    fetchTrails(user.id)
      .then(setTrails)
      .catch(() => setTrails([]));
    fetchTotalXp(user.id)
      .then(setTotalXp)
      .catch(() => setTotalXp(0));
  }, [user]);

  // Data-driven list: a trilha only appears once fetchTrails returns it,
  // which only happens if it has >=1 ponto linked via trilha_pontos. No
  // manual "ativo" flag anywhere.
  useEffect(() => {
    loadTrails();
    // If viewing a trail path, we want to reload activeTrail details too!
    if (activeTrail) {
      fetchTrails(user!.id).then((all) => {
        const updated = all.find((t) => t.id === activeTrail.id);
        if (updated) setActiveTrail(updated);
      }).catch(() => {});
    }
  }, [loadTrails, refreshKey]);

  // Re-check progress + badge grant whenever the active trail's data is
  // refreshed (e.g. after returning from a QR scan) — 100% completion
  // fires the badge grant exactly once (grantBadgeIfComplete is
  // idempotent), then flips the trophy modal open automatically.
  useEffect(() => {
    if (!user || !activeTrail) return;
    const { percent } = calculateTrailProgress(activeTrail);
    if (percent === 100 && !activeTrail.hasBadge) {
      grantBadgeIfComplete(user.id, activeTrail)
        .then((justGranted) => {
          if (justGranted) {
            // Medição: trilha concluída (id, cidade e número de paradas —
            // nenhum dado da pessoa).
            track("trilha_concluida", {
              trilha_id: activeTrail.id,
              cidade: activeTrail.cityName,
              paradas: activeTrail.points.length,
            });
            setActiveTrail((prev) => (prev ? { ...prev, hasBadge: true } : prev));
            setShowBadgeModal(true);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrail, user]);

  const handleOpenTrail = (trail: Trail) => {
    // "Iniciada" = a pessoa abriu a trilha e viu o caminho de paradas.
    track("trilha_iniciada", { trilha_id: trail.id, cidade: trail.cityName });
    setActiveTrail(trail);
  };

  const consumedAutoOpenRef = React.useRef<string | null>(null);

  // Voice assistant deep-link — open the matching city's trail once
  // trails have loaded. Case-insensitive substring match (voice transcript
  // may not match cadastro'd city name capitalization exactly).
  useEffect(() => {
    if (!autoOpenCity) {
      consumedAutoOpenRef.current = null;
      return;
    }
    if (trails.length === 0 || consumedAutoOpenRef.current === autoOpenCity) return;
    const match = trails.find((t) => t.cityName.toLowerCase().includes(autoOpenCity.toLowerCase()));
    if (match) {
      consumedAutoOpenRef.current = autoOpenCity;
      setActiveTrail(match);
    }
  }, [autoOpenCity, trails]);

  const handleCloseTrailPath = () => {
    setActiveTrail(null);
    setSelectedNode(null);
    loadTrails(); // pick up any scans confirmed while viewing this trail
  };

  const handleTrophyClick = () => {
    if (!activeTrail) return;
    const { percent } = calculateProgress(activeTrail);
    if (percent === 100) {
      setShowBadgeModal(true);
    }
  };

  const calculateProgress = calculateTrailProgress;

  const handleShareBadge = () => {
    if (navigator.share) {
      navigator
        .share({
          title: `Conquistei o Selo ${activeTrail?.badgeTitle}!`,
          text: `Concluí a trilha ${activeTrail?.trailTitle} em ${activeTrail?.cityName} pelo app Rota sem Barreiras! 🏆✨`,
          url: window.location.href,
        })
        .catch(() => {});
    } else {
      setShowShareSuccess(true);
      setTimeout(() => setShowShareSuccess(false), 3000);
    }
  };

  // Dynamic High Contrast classes
  const pageBg = isHighContrast ? "bg-black text-white" : "bg-bg-app text-text-main";
  const cardBg = isHighContrast
    ? "bg-zinc-950 border-2 border-white text-white"
    : "bg-white border border-gray-100 shadow-sm text-text-main";

  return (
    <div className={`w-full min-h-full pb-28 pt-[calc(env(safe-area-inset-top)+20px)] px-6 max-w-md md:max-w-2xl mx-auto flex flex-col gap-6 ${pageBg} xl:max-w-4xl xl:mx-auto xl:py-8 xl:px-8`}>
      
      {/* ================================================================
          SCENARIO 1: LIST OF TRAILS (CLEAN VERSION)
         ================================================================ */}
      {!activeTrail && (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="text-left flex items-start justify-between pt-4">
            <div className="flex flex-col">
              <h1 className="font-black text-2xl tracking-tight">Trilhas</h1>
              <p className="text-xs font-semibold text-text-secondary mt-1 max-w-[240px] leading-relaxed">
                Explore caminhos e registre suas visitas aos pontos turísticos.
              </p>
            </div>
            <div className="bg-brand-light text-brand font-black text-xs px-3 py-1.5 rounded-full border border-brand/20 shadow-xs flex items-center gap-1.5 flex-shrink-0 mt-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{totalXp} XP</span>
            </div>
          </div>

          {/* Simple flattened Trails List without city section lines */}
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-5">
            {trails.map((trail) => {
              const { scanned, total, percent } = calculateProgress(trail);

              return (
                <motion.div
                  key={trail.id}
                  onClick={() => handleOpenTrail(trail)}
                  whileTap={reduceMotion ? {} : { scale: 0.98 }}
                  className={`rounded-3xl p-5 flex flex-col gap-3.5 cursor-pointer transition-all hover:shadow-md ${cardBg}`}
                >
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase tracking-wider text-brand">
                      {trail.cityName}
                    </span>
                    <h3 className="font-black text-base leading-snug mt-0.5">{trail.trailTitle}</h3>
                    <p className="text-xs text-text-secondary font-medium mt-1 leading-relaxed line-clamp-2">
                      {trail.description}
                    </p>
                  </div>

                  {/* Progress Indicator */}
                  <div className="flex flex-col gap-1.5 pt-2">
                    <div className="flex items-center justify-between text-xs font-bold text-text-secondary">
                      <span>Progresso: {scanned}/{total} paradas</span>
                      <span>{percent}%</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================================================================
          SCENARIO 2: DUOLINGO-INSPIRED TRAIL PATH VIEW
         ================================================================ */}
      {activeTrail && (
        <motion.div
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 50 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          className="flex flex-col gap-6"
        >
          {/* Header Bar with Back Button */}
          <div className="flex items-center justify-between gap-3 border-b pb-4 border-gray-150">
            <button
              onClick={handleCloseTrailPath}
              className={`p-2 rounded-full transition-all active:scale-95 cursor-pointer ${
                isHighContrast
                  ? "bg-zinc-900 text-yellow-400 border border-zinc-700"
                  : "bg-white text-text-main shadow-sm border border-gray-100 hover:bg-gray-50"
              }`}
              aria-label="Voltar"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
            </button>

            <div className="flex-1 min-w-0 text-center">
              <span className="text-[9px] font-black uppercase tracking-wider text-brand">
                {activeTrail.cityName}
              </span>
              <h2 className="font-black text-sm truncate leading-tight">{activeTrail.trailTitle}</h2>
            </div>

            {/* Badge trophy button */}
            <button
              onClick={handleTrophyClick}
              className={`p-2.5 rounded-full transition-all active:scale-95 cursor-pointer flex items-center justify-center ${
                calculateProgress(activeTrail).percent === 100
                  ? "bg-brand text-white border-2 border-white shadow-md"
                  : "bg-gray-100 text-gray-400 border border-gray-200"
              }`}
              title="Selo da Trilha"
            >
              <Trophy className="w-5 h-5 fill-current" />
            </button>
          </div>

          {/* Simple Progress Box */}
          <div className={`rounded-3xl p-4.5 flex items-center justify-between text-xs font-bold text-text-secondary ${cardBg}`}>
            <span>Progresso: {calculateProgress(activeTrail).scanned} de {calculateProgress(activeTrail).total} paradas</span>
            <span className="text-brand font-black">{calculateProgress(activeTrail).percent}%</span>
          </div>

          {/* Duolingo Winding Path Container */}
          <div className="relative py-8 flex flex-col items-center gap-12 my-2 select-none">
            
            {/* Background SVG Winding Path Line */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none stroke-brand/35">
              <path
                d="M 50% 40 Q 80% 120, 50% 200 T 50% 360 T 50% 520 T 50% 680"
                fill="none"
                strokeWidth="5"
                strokeDasharray="6 6"
                strokeLinecap="round"
              />
            </svg>

            {/* Trail Nodes / Paradas */}
            {activeTrail.points.map((node, index) => {
              const alignments = ["self-center", "self-end pr-10", "self-center", "self-start pl-10"];
              const alignmentClass = alignments[index % alignments.length];

              return (
                <div key={node.id} className={`relative z-10 flex flex-col items-center ${alignmentClass}`}>
                  
                  {/* Circular Node Button */}
                  <motion.button
                    onClick={() => setSelectedNode(node)}
                    whileHover={reduceMotion ? {} : { scale: 1.05 }}
                    whileTap={reduceMotion ? {} : { scale: 0.95 }}
                    className={`w-18 h-18 rounded-full flex flex-col items-center justify-center relative shadow-lg transition-all cursor-pointer border-4 ${
                      node.isScanned
                        ? isHighContrast
                          ? "bg-yellow-400 border-white text-black ring-4 ring-yellow-400/20"
                          : "bg-brand border-white text-white ring-4 ring-brand/15"
                        : isHighContrast
                        ? "bg-zinc-900 border-zinc-700 text-zinc-400"
                        : "bg-white border-gray-200 text-text-secondary hover:border-brand/45"
                    }`}
                  >
                    {node.isScanned ? (
                      <Check className="w-7 h-7 stroke-[3.5]" />
                    ) : (
                      <MapPin className="w-7 h-7 stroke-[2.2] text-text-secondary" />
                    )}
                  </motion.button>

                  {/* Clean point name label */}
                  <div
                    onClick={() => setSelectedNode(node)}
                    className={`mt-2 px-3 py-1 rounded-2xl shadow-sm border text-center cursor-pointer max-w-[140px] ${
                      node.isScanned
                        ? isHighContrast
                          ? "bg-black border-yellow-400 text-yellow-400"
                          : "bg-brand-light/95 border-brand/10 text-brand"
                        : "bg-white border-gray-150 text-text-main"
                    }`}
                  >
                    <p className="font-extrabold text-[11px] truncate">{node.name}</p>
                  </div>

                </div>
              );
            })}

            {/* Ending Trophy Node */}
            <div className="relative z-10 flex flex-col items-center mt-2">
              <button
                onClick={handleTrophyClick}
                className={`w-20 h-20 rounded-full flex items-center justify-center shadow-xl transition-transform active:scale-95 cursor-pointer border-4 ${
                  calculateProgress(activeTrail).percent === 100
                    ? "bg-brand border-white text-white ring-6 ring-brand/15"
                    : "bg-gray-50 border-gray-200 text-gray-400"
                }`}
              >
                <Trophy className={`w-10 h-10 ${calculateProgress(activeTrail).percent === 100 ? "text-white fill-current" : "text-gray-400"}`} />
              </button>
            </div>

          </div>
        </motion.div>
      )}

      {/* ================================================================
          MODAL 1: POINT NODE DETAILS PREVIEW (COMPATIBLE BOTTOM SHEET)
         ================================================================ */}
      <AnimatePresence>
        {selectedNode && (
          <div className="absolute inset-0 z-50 flex items-end justify-center pointer-events-none">
            {/* Backdrop overlay within simulator frame */}
            <motion.div
              initial={reduceMotion ? { opacity: 0.4 } : { opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={reduceMotion ? { opacity: 0.4 } : { opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : undefined}
              onClick={() => setSelectedNode(null)}
              className="absolute inset-0 bg-black z-30 pointer-events-auto cursor-pointer"
            />

            <motion.div
              initial={reduceMotion ? { y: 0 } : { y: "100%" }}
              animate={{ y: 0 }}
              exit={reduceMotion ? { y: 0 } : { y: "100%" }}
              transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 25, stiffness: 220 }}
              className={`absolute bottom-0 left-0 right-0 z-40 rounded-t-[32px] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] border-t border-gray-100 w-full overflow-hidden pb-8 pointer-events-auto text-left ${
                isHighContrast ? "bg-black border-t-2 border-white text-white" : "bg-white text-text-main"
              }`}
            >
              {/* Handle Bar */}
              <div className="flex justify-center py-4">
                <div className="w-16 h-2 bg-gray-200 rounded-full" />
              </div>

              {/* Content */}
              <div className="px-6 flex flex-col gap-4 relative">
                {/* Close button */}
                <button
                  onClick={() => setSelectedNode(null)}
                  className="absolute top-2 right-6 p-2 bg-gray-50 hover:bg-gray-100 rounded-full text-text-secondary transition-colors active:scale-95 cursor-pointer z-10"
                  title="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Cover Photo and Title Row */}
                <div className="flex items-center gap-4 pr-10">
                  <div className="w-20 h-20 rounded-2xl overflow-hidden bg-gray-100 flex-shrink-0">
                    {selectedNode.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={selectedNode.image} alt={selectedNode.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-200 flex items-center justify-center text-xs text-gray-400 font-bold">
                        Sem foto
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-extrabold text-text-main leading-tight">
                      {selectedNode.name}
                    </h3>
                  </div>
                </div>

                {/* Action Buttons: Ver no Mapa and Escanear vertically stacked */}
                <div className="flex flex-col gap-3 mt-2">
                  <button
                    onClick={() => {
                      setSelectedNode(null);
                      const real = points?.find((p) => p.id === selectedNode.id);
                      if (real && onSelectPointFromTrail) onSelectPointFromTrail(real);
                    }}
                    className={`w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white font-extrabold text-sm tracking-wider uppercase py-4.5 px-6 rounded-full transition-all duration-200 active:scale-95 shadow-md shadow-brand/10 cursor-pointer`}
                  >
                    <Map className="w-4.5 h-4.5" />
                    Ver no Mapa
                  </button>

                  {!selectedNode.isScanned && (
                    <button
                      onClick={() => {
                        setSelectedNode(null);
                        if (onOpenScanner) onOpenScanner();
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white font-extrabold text-sm tracking-wider uppercase py-4.5 px-6 rounded-full transition-all duration-200 active:scale-95 shadow-md cursor-pointer"
                    >
                      <QrCode className="w-4.5 h-4.5" />
                      Escanear e Desbloquear
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================================================================
          MODAL 2: COMPLETED TRAIL ACHIEVEMENT BADGE & SHARE (COMPATIBLE BOTTOM SHEET)
         ================================================================ */}
      <AnimatePresence>
        {showBadgeModal && activeTrail && (
          <div className="absolute inset-0 z-50 flex items-end justify-center pointer-events-none">
            {/* Backdrop overlay within simulator frame */}
            <motion.div
              initial={reduceMotion ? { opacity: 0.4 } : { opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={reduceMotion ? { opacity: 0.4 } : { opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : undefined}
              onClick={() => setShowBadgeModal(false)}
              className="absolute inset-0 bg-black z-30 pointer-events-auto cursor-pointer"
            />

            <motion.div
              initial={reduceMotion ? { y: 0 } : { y: "100%" }}
              animate={{ y: 0 }}
              exit={reduceMotion ? { y: 0 } : { y: "100%" }}
              transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 25, stiffness: 220 }}
              className={`absolute bottom-0 left-0 right-0 z-40 rounded-t-[32px] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] border-t border-gray-100 w-full overflow-hidden pb-8 pointer-events-auto flex flex-col items-center text-center gap-5 ${
                isHighContrast ? "bg-black border-t-2 border-white text-white" : "bg-white text-text-main"
              }`}
            >
              {/* Handle Bar */}
              <div className="flex justify-center py-4">
                <div className="w-16 h-2 bg-gray-200 rounded-full" />
              </div>

              <button
                onClick={() => setShowBadgeModal(false)}
                className="absolute top-4 right-4 p-2.5 bg-gray-50 hover:bg-gray-100 rounded-full text-text-secondary cursor-pointer"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Conquest badge: orange and white logo style */}
              <div className="relative mt-2">
                <div className="w-28 h-28 rounded-full bg-brand-light border-4 border-brand flex items-center justify-center text-brand">
                  <Trophy className="w-12 h-12 fill-current" />
                </div>
              </div>

              <div className="px-6">
                <h3 className="font-black text-xl text-text-main">{activeTrail.badgeTitle}</h3>
                <p className="text-sm text-text-secondary font-semibold mt-2 leading-relaxed">
                  Selo conquistado por visitar os pontos turísticos de {activeTrail.cityName}.
                </p>
              </div>

              {showShareSuccess && (
                <div className="mx-6 w-[calc(100%-48px)] bg-emerald-600 text-white text-xs font-black py-2 rounded-xl flex items-center justify-center gap-1.5 animate-fade-in">
                  ✓ Link de Conquista Copiado!
                </div>
              )}

              <div className="flex flex-col gap-3 w-full px-6 pt-2">
                <button
                  onClick={handleShareBadge}
                  className="w-full flex items-center justify-center gap-2.5 bg-brand hover:bg-brand-dark text-white font-extrabold text-base tracking-wider uppercase py-4.5 px-6 rounded-full transition-all duration-200 active:scale-95 shadow-md shadow-brand/10 cursor-pointer"
                >
                  <Share2 className="w-5 h-5" />
                  Compartilhar
                </button>
                <button
                  onClick={() => setShowBadgeModal(false)}
                  className="w-full py-4 rounded-full font-bold text-sm bg-gray-50 text-text-secondary hover:bg-gray-100 active:scale-95 cursor-pointer"
                >
                  Fechar
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
