"use client";

import React, { useEffect, useState } from "react";
import { TouristPoint } from "@/types/point";
import { Mail, ChevronRight, History, Accessibility, LogOut, UserPlus, LogIn } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import LoginPage from "./LoginPage";
import PrivacyPolicySheet from "./PrivacyPolicySheet";

interface ProfileViewProps {
  searchedPoints: TouristPoint[];
  onSelectPoint: (point: TouristPoint) => void;
  onOpenAuthModal?: () => void;
}

export default function ProfileView({ searchedPoints, onSelectPoint }: ProfileViewProps) {
  const { user, profile, isAnonymous, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
  };

  // When in visitor / anonymous mode, going to Profile goes DIRECTLY to the login screen!
  if (isAnonymous) {
    return (
      <div className="w-full h-full min-h-full bg-bg-app relative">
        <LoginPage initialScreen="signin" />
      </div>
    );
  }

  const displayName = profile?.full_name || user?.email?.split("@")[0] || "Usuário";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="w-full min-h-full bg-bg-app pb-28 pt-[calc(env(safe-area-inset-top)+20px)] px-6 max-w-md md:max-w-2xl mx-auto flex flex-col gap-8 xl:max-w-3xl xl:mx-auto xl:py-8">
      <h2 className="text-center font-black text-xl text-text-main">Perfil do Usuário</h2>

      <div className="flex flex-col items-center text-center mt-2">
        <div className="relative w-28 h-28 rounded-full border-4 border-white shadow-lg overflow-hidden bg-brand-light flex items-center justify-center">
          <span className="text-3xl font-black text-brand">{initials}</span>
        </div>
        <h3 className="text-2xl font-black text-text-main mt-5">{displayName}</h3>
        <p className="text-sm font-bold text-text-secondary mt-1.5 flex items-center gap-2 justify-center">
          <Mail className="w-4 h-4 text-brand" />
          {user?.email}
        </p>
      </div>

      {/* Search history — from account */}
      <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <h3 className="text-lg font-black text-text-main flex items-center gap-2.5">
            <History className="w-5 h-5 text-brand" />
            Locais Pesquisados
          </h3>
        </div>

        {searchedPoints.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-base text-text-secondary font-bold">Nenhum local pesquisado ainda.</p>
            <p className="text-sm text-text-secondary/70 mt-2 max-w-[260px] mx-auto leading-relaxed font-semibold">
              Explore o mapa ou escaneie um QR Code para registrar suas visitas!
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 max-h-80 overflow-y-auto no-scrollbar pr-1">
            {searchedPoints.map((point) => (
              <button
                key={point.id}
                onClick={() => onSelectPoint(point)}
                className="w-full flex items-center justify-between p-4.5 bg-bg-app/40 hover:bg-brand-light/30 rounded-2xl border border-gray-50/60 transition-all text-left tap-highlight-none active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    {point.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={point.image} alt={point.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-200 flex items-center justify-center text-[10px] text-gray-400 font-bold">
                        Sem foto
                      </div>
                    )}
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-text-main leading-tight">{point.name}</h4>
                    <p className="text-xs text-text-secondary mt-1 font-bold">{point.category}</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-text-secondary" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Logout button (only if registered user) */}
      {!isAnonymous && (
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full flex items-center justify-center gap-2.5 bg-white border border-gray-100 hover:bg-red-50 text-red-600 font-extrabold text-base py-4.5 rounded-full transition-all active:scale-95 shadow-sm disabled:opacity-60 cursor-pointer"
        >
          <LogOut className="w-5 h-5" />
          {loggingOut ? "Saindo..." : "Sair da Conta"}
        </button>
      )}

      {/* Política de Privacidade — fim da tela, separada por uma linha. */}
      <div className="border-t border-gray-150 pt-4">
        <button
          onClick={() => setPrivacyOpen(true)}
          className="w-full text-center text-xs font-bold text-text-secondary hover:text-brand underline py-2"
        >
          Política de Privacidade
        </button>
      </div>

      <PrivacyPolicySheet isOpen={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}
