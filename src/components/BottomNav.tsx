"use client";

import React from "react";
import { Map, Route, User, Sparkles } from "lucide-react";
import { TRAILS_ENABLED } from "@/lib/featureFlags";

interface BottomNavProps {
  activeTab: "home" | "trails" | "voice" | "profile";
  setActiveTab: (tab: "home" | "trails" | "voice" | "profile") => void;
}

export default function BottomNav({ activeTab, setActiveTab }: BottomNavProps) {
  return (
    <nav
      aria-label="Navegação principal"
      className="relative bg-white border-t border-gray-100 px-2 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+10px)] z-40 select-none flex-shrink-0 xl:hidden"
    >
      <div className="flex w-full items-center justify-around h-16 px-2 md:px-8">
        
        {/* Tab 1: Explorar */}
        <button
          onClick={() => setActiveTab("home")}
          aria-current={activeTab === "home" ? "page" : undefined}
          className="flex-1 min-h-[44px] flex flex-col items-center justify-center gap-1 h-full tap-highlight-none focus:outline-none py-1 group cursor-pointer"
        >
          <div
            className={`w-14 h-8.5 rounded-full flex items-center justify-center transition-all duration-200 ${
              activeTab === "home"
                ? "bg-brand-light text-brand scale-105"
                : "text-text-secondary group-hover:bg-gray-50"
            }`}
          >
            <Map className={`w-6 h-6 ${activeTab === "home" ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
          </div>
          <span
            className={`text-xs tracking-wide transition-colors duration-200 ${
              activeTab === "home" ? "font-black text-brand" : "font-semibold text-text-secondary"
            }`}
          >
            Explorar
          </span>
        </button>

        {/* Tab 2: Trilhas (Gamificação) — hidden while TRAILS_ENABLED is
            false. The remaining tabs are flex-1 inside justify-around, so
            they re-space evenly on their own (no layout fix needed). */}
        {TRAILS_ENABLED && (
        <button
          onClick={() => setActiveTab("trails")}
          aria-current={activeTab === "trails" ? "page" : undefined}
          className="flex-1 min-h-[44px] flex flex-col items-center justify-center gap-1 h-full tap-highlight-none focus:outline-none py-1 group cursor-pointer"
        >
          <div
            className={`w-14 h-8.5 rounded-full flex items-center justify-center transition-all duration-200 ${
              activeTab === "trails"
                ? "bg-brand-light text-brand scale-105"
                : "text-text-secondary group-hover:bg-gray-50"
            }`}
          >
            <Route className={`w-6 h-6 ${activeTab === "trails" ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
          </div>
          <span
            className={`text-xs tracking-wide transition-colors duration-200 ${
              activeTab === "trails" ? "font-black text-brand" : "font-semibold text-text-secondary"
            }`}
          >
            Trilhas
          </span>
        </button>
        )}

        {/* Tab 3: Voz (Assistente) */}
        <button
          onClick={() => setActiveTab("voice")}
          aria-current={activeTab === "voice" ? "page" : undefined}
          className="flex-1 min-h-[44px] flex flex-col items-center justify-center gap-1 h-full tap-highlight-none focus:outline-none py-1 group cursor-pointer"
        >
          <div
            className={`w-14 h-8.5 rounded-full flex items-center justify-center transition-all duration-200 ${
              activeTab === "voice"
                ? "bg-brand-light text-brand scale-105"
                : "text-text-secondary group-hover:bg-gray-50"
            }`}
          >
            <Sparkles className={`w-6 h-6 ${activeTab === "voice" ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
          </div>
          <span
            className={`text-xs tracking-wide transition-colors duration-200 ${
              activeTab === "voice" ? "font-black text-brand" : "font-semibold text-text-secondary"
            }`}
          >
            Voz
          </span>
        </button>

        {/* Tab 4: Perfil */}
        <button
          onClick={() => setActiveTab("profile")}
          aria-current={activeTab === "profile" ? "page" : undefined}
          className="flex-1 min-h-[44px] flex flex-col items-center justify-center gap-1 h-full tap-highlight-none focus:outline-none py-1 group cursor-pointer"
        >
          <div
            className={`w-14 h-8.5 rounded-full flex items-center justify-center transition-all duration-200 ${
              activeTab === "profile"
                ? "bg-brand-light text-brand scale-105"
                : "text-text-secondary group-hover:bg-gray-50"
            }`}
          >
            <User className={`w-6 h-6 ${activeTab === "profile" ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
          </div>
          <span
            className={`text-xs tracking-wide transition-colors duration-200 ${
              activeTab === "profile" ? "font-black text-brand" : "font-semibold text-text-secondary"
            }`}
          >
            Perfil
          </span>
        </button>
        
      </div>
    </nav>
  );
}
