"use client";

import React from "react";
import { TouristPoint } from "@/types/point";
import { X, Accessibility, Volume2, Bookmark, Eye, HeartHandshake } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";

interface BottomSheetProps {
  point: TouristPoint | null;
  onClose: () => void;
  onViewDetails: (point: TouristPoint) => void;
}

export default function BottomSheet({ point, onClose, onViewDetails }: BottomSheetProps) {
  const { preferences } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;

  return (
    <AnimatePresence>
      {point && (
        <>
          {/* Overlay backdrop relative to parent container */}
          <motion.div
            initial={reduceMotion ? { opacity: 0.3 } : { opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={reduceMotion ? { opacity: 0.3 } : { opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : undefined}
            onClick={onClose}
            className="absolute inset-0 bg-black z-30 pointer-events-auto xl:hidden"
          />

          {/* Bottom Sheet Card / Desktop Side Sheet — hidden on desktop (pin click goes straight to PointDetails) */}
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

            {/* Content */}
            <div className="px-6 md:px-10">
              {/* Header */}
              <div className="flex justify-between items-start gap-4">
                <div>
                  <span className="text-[11px] uppercase font-extrabold tracking-widest text-brand bg-brand-light px-3 py-1.5 rounded-full">
                    {point.category}
                  </span>
                  <h3 className="text-2xl font-extrabold text-text-main mt-3 leading-tight">
                    {point.name}
                  </h3>
                </div>
                <button
                  onClick={onClose}
                  className="p-2.5 bg-gray-50 hover:bg-gray-100 rounded-full text-text-secondary transition-colors active:scale-95"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Description - Larger text for accessibility */}
              <p className="text-base text-text-secondary mt-4 leading-relaxed font-semibold">
                {point.description}
              </p>

              {/* Quick Accessibility Badges - Larger */}
              <div className="mt-5 flex flex-wrap gap-2.5">
                {point.accessibility.wheelchair && (
                  <span className="flex items-center gap-2 text-xs text-brand bg-brand-light px-4 py-2 rounded-full font-bold">
                    <Accessibility className="w-4 h-4" />
                    Rampa
                  </span>
                )}
                {point.accessibility.audio && (
                  <span className="flex items-center gap-2 text-xs text-brand bg-brand-light px-4 py-2 rounded-full font-bold">
                    <Volume2 className="w-4 h-4" />
                    Áudio
                  </span>
                )}
                {point.accessibility.libras && (
                  <span className="flex items-center gap-2 text-xs text-brand bg-brand-light px-4 py-2 rounded-full font-bold">
                    <Bookmark className="w-4 h-4" />
                    Libras
                  </span>
                )}
                {point.accessibility.attendance && (
                  <span className="flex items-center gap-2 text-xs text-brand bg-brand-light px-4 py-2 rounded-full font-bold">
                    <HeartHandshake className="w-4 h-4" />
                    Atendimento
                  </span>
                )}
              </div>

              {/* Action Button - Taller, Fatter, Larger font for senior finger tapping */}
              <div className="mt-7 flex items-center justify-between gap-4">
                <button
                  onClick={() => onViewDetails(point)}
                  className="flex-1 flex items-center justify-center gap-2.5 bg-brand hover:bg-brand-dark text-white font-extrabold text-base tracking-wider uppercase py-4.5 px-6 rounded-full transition-all duration-200 active:scale-95 shadow-md shadow-brand/10"
                >
                  <Eye className="w-5.5 h-5.5" />
                  Ver Detalhes do Local
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
