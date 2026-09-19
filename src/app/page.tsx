"use client";

import React, { useEffect, useState, useCallback } from "react";
import { TouristPoint } from "@/types/point";
import BottomNav from "../components/BottomNav";
import SearchBar from "../components/SearchBar";
import dynamic from "next/dynamic";
const CustomMap = dynamic(() => import("../components/CustomMap"), { ssr: false });
import BottomSheet from "../components/BottomSheet";
import PointDetails from "../components/PointDetails";
import ProfileView from "../components/ProfileView";
import QRCodeScanner from "../components/QRCodeScanner";
import LoginPage from "../components/LoginPage";
import ExploreBottomSheet from "../components/ExploreBottomSheet";
import AccessibilityMenu from "../components/AccessibilityMenu";
import SuggestLocationSheet from "../components/SuggestLocationSheet";
import OutOfAreaNotice from "../components/OutOfAreaNotice";
import { GV_CENTER, isGovernadorValadaresName, isNearGovernadorValadares } from "@/lib/location";
import { reverseGeocodeCity } from "@/services/geocodingService";
// Trails (Trilhas / gamificação) — lazily loaded on purpose: while
// TRAILS_ENABLED is false nothing ever renders it, so the browser never
// downloads or runs the trails chunk at all. Flip the flag to restore it.
const TrailsView = dynamic(() => import("../components/TrailsView"), { ssr: false });
import VoiceView from "../components/VoiceView";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { TRAILS_ENABLED } from "@/lib/featureFlags";
import {
  buildAccessibilityClassName,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  type AccessibilitySettings,
  type ColorSaturation,
  type FontScale,
  type LineHeightPref,
  type TextSpacing,
} from "@/lib/accessibility";
import { fetchTouristPoints, fetchSearchHistory, recordSearch, recordScan } from "@/services/pointsService";
import type { AddressResult } from "@/services/geocodingService";
import { Landmark, Trees, Utensils, Sparkles, Compass, Navigation, Map, Route, User, PanelLeftClose, PanelLeftOpen, X, LogIn, UserPlus } from "lucide-react";

const CATEGORIES = ["Todos", "Patrimônio", "Cultura", "Lazer", "Gastronomia", "Natureza", "Religião"];

/** Texto anunciado pelo leitor de tela ao trocar de aba (região aria-live). */
const SCREEN_LABELS: Record<"home" | "trails" | "voice" | "profile", string> = {
  home: "Tela Explorar: mapa dos pontos turísticos",
  trails: "Tela Trilhas",
  voice: "Tela Assistente de Voz",
  profile: "Tela Perfil",
};

function getCategoryIcon(cat: string) {
  switch (cat.toLowerCase()) {
    case "patrimônio":
      return <Landmark className="w-4 h-4" />;
    case "cultura":
      return <Sparkles className="w-4 h-4" />;
    case "lazer":
      return <Trees className="w-4 h-4" />;
    case "gastronomia":
      return <Utensils className="w-4 h-4" />;
    case "natureza":
      return <Compass className="w-4 h-4" />;
    case "religião":
      return <Landmark className="w-4 h-4" />;
    default:
      return <Compass className="w-4 h-4" />;
  }
}

export default function App() {
  const { user, loading: authLoading, preferences, updatePreferences, isAnonymous } = useAuth();

  const [points, setPoints] = useState<TouristPoint[]>([]);
  const [activeTab, setActiveTab] = useState<"home" | "trails" | "voice" | "profile">("home");
  // Desktop sidebar collapsed state (default: true = collapsed/icon-only)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<TouristPoint | null>(null);
  const [activeDetailsPoint, setActiveDetailsPoint] = useState<TouristPoint | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [searchedPoints, setSearchedPoints] = useState<TouristPoint[]>([]);
  const [scanOrigin, setScanOrigin] = useState<"map" | "trail">("map");
  const [trailsRefreshKey, setTrailsRefreshKey] = useState(0);
  const [voiceRequestedCity, setVoiceRequestedCity] = useState<string | null>(null);
  const [isSuggestSheetOpen, setIsSuggestSheetOpen] = useState(false);

  // Map Filter and Geolocation states
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [flyToCoords, setFlyToCoords] = useState<[number, number] | null>(null);
  // Aviso "você está fora de Governador Valadares". Só existe se o app JÁ
  // recebeu uma localização autorizada — nunca pede permissão por causa dele.
  const [outOfArea, setOutOfArea] = useState<{ open: boolean; city: string | null }>({
    open: false,
    city: null,
  });
  const outOfAreaCheckedRef = React.useRef(false);
  const [exploreSheetState, setExploreSheetState] = useState<"collapsed" | "expanded">("collapsed");

  // Accessibility States — local state drives render instantly (snappy
  // toggle feel); synced from `preferences` once loaded, persisted back
  // to Supabase on every change via updatePreferences.
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [fontScale, setFontScale] = useState<FontScale>("normal");
  const [vLibrasActive, setVLibrasActive] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Central de Acessibilidade — recursos visuais e de leitura. Same pattern
  // as the toggles above: local state renders instantly, Supabase persists.
  const [saturation, setSaturation] = useState<ColorSaturation>("normal");
  const [textSpacing, setTextSpacing] = useState<TextSpacing>("normal");
  const [lineHeight, setLineHeight] = useState<LineHeightPref>("normal");
  const [hideImages, setHideImages] = useState(false);
  const [dyslexiaMode, setDyslexiaMode] = useState(false);

  // Seed local toggle state from the user's saved preferences. By the time
  // authLoading flips false, AuthContext has already awaited this fetch
  // (see AuthContext.tsx), so this effect fires while <LoadingScreen /> is
  // still on screen — no flash of unstyled/wrong-theme content once the
  // real UI paints.
  useEffect(() => {
    if (!preferences) return;
    setIsHighContrast(preferences.high_contrast_enabled);
    // font_scale may be missing on rows created before that column existed
    // (pre-migration) — fall back to "normal" instead of storing undefined.
    setFontScale(preferences.font_scale ?? "normal");
    setVLibrasActive(preferences.libras_enabled);
    setVoiceActive(preferences.audio_enabled);
    setReduceMotion(preferences.reduce_motion_enabled ?? false);
    // Columns added by migrations_acessibilidade_central.sql — `?? default`
    // keeps the app working on rows saved before that migration ran.
    setSaturation(preferences.color_saturation ?? "normal");
    setTextSpacing(preferences.text_spacing ?? "normal");
    setLineHeight(preferences.line_height ?? "normal");
    setHideImages(preferences.hide_images_enabled ?? false);
    setDyslexiaMode(preferences.dyslexia_mode_enabled ?? false);
  }, [preferences]);

  const handleSetHighContrast = (value: boolean) => {
    setIsHighContrast(value);
    updatePreferences({ high_contrast_enabled: value }).catch(() => {});
  };

  const handleSetFontScale = (scale: "normal" | "lg" | "xl") => {
    setFontScale(scale);
    updatePreferences({ font_scale: scale }).catch(() => {});
  };

  const FONT_STEPS: Array<"normal" | "lg" | "xl"> = ["normal", "lg", "xl"];
  const handleIncreaseFontScale = () => {
    const idx = FONT_STEPS.indexOf(fontScale);
    handleSetFontScale(FONT_STEPS[Math.min(idx + 1, FONT_STEPS.length - 1)]);
  };
  const handleDecreaseFontScale = () => {
    const idx = FONT_STEPS.indexOf(fontScale);
    handleSetFontScale(FONT_STEPS[Math.max(idx - 1, 0)]);
  };

  const handleSetVLibrasActive = (value: boolean) => {
    setVLibrasActive(value);
    updatePreferences({ libras_enabled: value }).catch(() => {});
  };

  const handleSetVoiceActive = (value: boolean) => {
    setVoiceActive(value);
    updatePreferences({ audio_enabled: value }).catch(() => {});
  };

  const handleSetReduceMotion = (value: boolean) => {
    setReduceMotion(value);
    updatePreferences({ reduce_motion_enabled: value }).catch(() => {});
  };

  const handleSetSaturation = (value: ColorSaturation) => {
    setSaturation(value);
    updatePreferences({ color_saturation: value }).catch(() => {});
  };

  const handleSetTextSpacing = (value: TextSpacing) => {
    setTextSpacing(value);
    updatePreferences({ text_spacing: value }).catch(() => {});
  };

  const handleSetLineHeight = (value: LineHeightPref) => {
    setLineHeight(value);
    updatePreferences({ line_height: value }).catch(() => {});
  };

  const handleSetHideImages = (value: boolean) => {
    setHideImages(value);
    updatePreferences({ hide_images_enabled: value }).catch(() => {});
  };

  const handleSetDyslexiaMode = (value: boolean) => {
    setDyslexiaMode(value);
    updatePreferences({ dyslexia_mode_enabled: value }).catch(() => {});
  };

  /** "Restaurar configurações" — puts every accessibility setting back to the
   * app's original design in one shot (one Supabase write, not nine). */
  const handleResetAccessibility = () => {
    const d = DEFAULT_ACCESSIBILITY_SETTINGS;
    setIsHighContrast(d.highContrast);
    setFontScale(d.fontScale);
    setVoiceActive(d.voiceReading);
    setReduceMotion(d.reduceMotion);
    setSaturation(d.saturation);
    setTextSpacing(d.textSpacing);
    setLineHeight(d.lineHeight);
    setHideImages(d.hideImages);
    setDyslexiaMode(d.dyslexiaMode);
    updatePreferences({
      high_contrast_enabled: d.highContrast,
      font_scale: d.fontScale,
      audio_enabled: d.voiceReading,
      reduce_motion_enabled: d.reduceMotion,
      color_saturation: d.saturation,
      text_spacing: d.textSpacing,
      line_height: d.lineHeight,
      hide_images_enabled: d.hideImages,
      dyslexia_mode_enabled: d.dyslexiaMode,
    }).catch(() => {});
  };

  // --- Aviso de área de cobertura -----------------------------------------
  // Regras: só roda com localização já autorizada; uma vez dispensado, não
  // volta na mesma sessão (sessionStorage); se o geocodificador reverso falhar,
  // cai no critério geométrico (raio a partir do centro da cidade) e usa texto
  // genérico em vez de inventar o nome de uma cidade.
  const OUT_OF_AREA_DISMISS_KEY = "rotas_aviso_fora_de_area";

  useEffect(() => {
    if (!userLocation || outOfAreaCheckedRef.current) return;
    if (isNearGovernadorValadares(userLocation)) {
      outOfAreaCheckedRef.current = true;
      return;
    }
    try {
      if (sessionStorage.getItem(OUT_OF_AREA_DISMISS_KEY) === "1") {
        outOfAreaCheckedRef.current = true;
        return;
      }
    } catch {
      // sessionStorage indisponível (modo privado antigo): segue e mostra.
    }

    outOfAreaCheckedRef.current = true;
    let cancelled = false;

    reverseGeocodeCity(userLocation[0], userLocation[1])
      .then((city) => {
        if (cancelled) return;
        // Distrito de Valadares com nome diferente no geocodificador: se o nome
        // contém "Valadares", trata como dentro da área e não avisa nada.
        if (isGovernadorValadaresName(city)) return;
        setOutOfArea({ open: true, city });
      })
      .catch(() => {
        if (!cancelled) setOutOfArea({ open: true, city: null });
      });

    return () => {
      cancelled = true;
    };
  }, [userLocation]);

  const dismissOutOfArea = useCallback(() => {
    setOutOfArea((prev) => ({ ...prev, open: false }));
    try {
      sessionStorage.setItem(OUT_OF_AREA_DISMISS_KEY, "1");
    } catch {
      // Sem storage o aviso pode reaparecer em outra navegação; aceitável.
    }
  }, []);

  const goToCoverageArea = useCallback(() => {
    // Reaproveita o fly-to que o botão de recentralizar já usa.
    setActiveTab("home");
    setFlyToCoords(GV_CENTER);
    dismissOutOfArea();
  }, [dismissOutOfArea]);

  const accessibilitySettings: AccessibilitySettings = {
    highContrast: isHighContrast,
    fontScale,
    voiceReading: voiceActive,
    reduceMotion,
    saturation,
    textSpacing,
    lineHeight,
    hideImages,
    dyslexiaMode,
  };

  // Load points from Supabase (public.pontos) + user history once authenticated.
  // No mock fallback — table is single source of truth, new cadastro rows show
  // up automatically on next fetch, no code change needed.
  useEffect(() => {
    if (!user) return;

    fetchTouristPoints()
      .then(setPoints)
      .catch((e) => {
        console.warn("Pontos turísticos indisponíveis (mostrando mapa vazio):", e);
        setPoints([]);
      });

    fetchSearchHistory(user.id)
      .then(setSearchedPoints)
      .catch(() => setSearchedPoints([]));
  }, [user]);

  // Request User Geolocation on Mount
  useEffect(() => {
    if (!user) return;

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords: [number, number] = [position.coords.latitude, position.coords.longitude];
          setUserLocation(coords);
          setFlyToCoords(coords);
        },
        (error) => {
          console.warn("Geolocation warning:", error.message);
        },
        { enableHighAccuracy: true }
      );
    }
  }, [user]);

  const handleRecenter = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords: [number, number] = [position.coords.latitude, position.coords.longitude];
          setUserLocation(coords);
          setFlyToCoords(coords);
        },
        () => {
          alert("Não foi possível acessar a geolocalização. Por favor, ative as permissões de localização no seu navegador.");
        },
        { enableHighAccuracy: true }
      );
    } else {
      alert("Geolocalização não é suportada por este dispositivo.");
    }
  };

  const persistSearch = useCallback(
    (pointId: string) => {
      if (!user) return;
      recordSearch(user.id, pointId).catch(() => {
        // non-critical
      });
    },
    [user]
  );

  // Single chokepoint for every tab change (sidebar, BottomNav, voice
  // assistant). While TRAILS_ENABLED is false, "trails" is coerced to
  // "home" here, so no caller — present or future — can reach the view.
  const setActiveTabSafe = (tab: "home" | "trails" | "voice" | "profile") => {
    setActiveTab(!TRAILS_ENABLED && tab === "trails" ? "home" : tab);
  };

  const handleSetActiveTab = (tab: "home" | "trails" | "voice" | "profile") => {
    setActiveTabSafe(tab);
    setActiveDetailsPoint(null);
    setIsScannerOpen(false);
    setSelectedPoint(null);
    setVoiceRequestedCity(null);
  };

  // Detect if we are on a true desktop viewport (>= 1280px) — ensures
  // tablets (portrait & landscape) receive the responsive full-screen interface.
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= 1280);
    };
    checkIsDesktop();
    window.addEventListener("resize", checkIsDesktop);
    return () => window.removeEventListener("resize", checkIsDesktop);
  }, []);

  const isValidCoords = (lat: unknown, lng: unknown): lat is number =>
    typeof lat === "number" && typeof lng === "number" && !Number.isNaN(lat) && !Number.isNaN(lng);

  const handleSelectPointFromMapOrSearch = (point: TouristPoint) => {
    if (!point || !point.coords || !isValidCoords(point.coords.lat, point.coords.lng)) return;
    const { lat, lng } = point.coords;

    if (isDesktop) {
      // Desktop: skip preview bottom sheet, go directly to full details,
      // and offset longitude (-0.008) so the marker lands in the center of the visible map area
      addToHistory(point);
      setActiveDetailsPoint(point);
      setFlyToCoords([lat, lng - 0.008]);
    } else {
      setSelectedPoint(point);
      // Center map on selected point coords
      setFlyToCoords([lat, lng]);
    }
  };

  // Address result (Photon) — just center/zoom the map, no ponto detail
  // screen exists for a plain address, so skip selectedPoint/BottomSheet.
  const handleSelectAddress = (address: AddressResult) => {
    if (!address || !isValidCoords(address.lat, address.lng)) return;
    setSelectedPoint(null);
    setFlyToCoords([address.lat, address.lng]);
  };

  const addToHistory = (point: TouristPoint) => {
    setSearchedPoints((prev) => (prev.some((p) => p.id === point.id) ? prev : [point, ...prev]));
    persistSearch(point.id);
  };

  const handleViewDetails = (point: TouristPoint) => {
    addToHistory(point);
    setActiveDetailsPoint(point);
    setSelectedPoint(null);
  };

  const handleScanSuccess = (point: TouristPoint) => {
    setIsScannerOpen(false);
    addToHistory(point);
    // QR confirmation only — this is the single source of truth for trail
    // progress + XP. Not the same as addToHistory's recordSearch, which
    // also fires on plain map/search taps (not proof of physical visit).
    if (user) {
      recordScan(user.id, point.id)
        .then(() => {
          if (scanOrigin === "trail") {
            setTrailsRefreshKey((prev) => prev + 1);
          } else {
            setActiveDetailsPoint(point);
          }
        })
        .catch(() => {
          if (scanOrigin !== "trail") {
            setActiveDetailsPoint(point);
          } else {
            setTrailsRefreshKey((prev) => prev + 1);
          }
        });
    } else {
      if (scanOrigin !== "trail") {
        setActiveDetailsPoint(point);
      }
    }
  };

  // Filter tourist points according to active category tag (using case-insensitive substring matching)
  const filteredPoints = selectedCategory
    ? points.filter((p) => p.category.toLowerCase().includes(selectedCategory.toLowerCase()))
    : points;

  return (
    <main className="w-full h-dvh bg-bg-app overflow-hidden font-sans antialiased">
      {/* Every accessibility setting is a class on this container (see
          src/lib/accessibility.ts + the Central de Acessibilidade block in
          globals.css). Nothing is written as inline style, so clearing the
          settings restores the original design exactly. */}
      <div
        className={`relative w-full h-full bg-bg-app overflow-hidden flex flex-col xl:flex-row transition-colors duration-250 ${buildAccessibilityClassName(
          accessibilitySettings
        )}`}
      >
        <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>

        {/* Pular para o conteúdo (WCAG 2.4.1). Fica invisível até receber foco
            pelo teclado — estilo em globals.css (.skip-link). */}
        <a href="#conteudo-principal" className="skip-link">
          Ir para o conteúdo principal
        </a>

        {/* Título da tela para leitor de tela. A interface é visualmente um
            mapa sem título escrito; sem este h1 a página não tem cabeçalho
            de nível 1 (WCAG 1.3.1 / 2.4.6). Cada tela interna (Trilhas, Voz,
            Central de Acessibilidade) já tem o seu próprio h1. */}
        {activeTab === "home" && (
          <h1 className="sr-only-a11y">
            Rota sem Barreiras — mapa de turismo acessível em Governador Valadares (MG)
          </h1>
        )}

        {/* Troca de tela é um SPA sem mudança de URL: sem isto o leitor de tela
            não anuncia nada ao trocar de aba (WCAG 4.1.3 Status Messages). */}
        <p aria-live="polite" role="status" className="sr-only-a11y">
          {SCREEN_LABELS[activeTab]}
        </p>

        {/* Desktop Left Sidebar Navigation (Visible ONLY on xl: true desktop screens >= 1280px)
            Collapsed by default — shows only icons. Expand button toggles labels.
            Stays fixed at z-40 so side sheets (z-60) slide over it smoothly without DOM jump.
        */}
        <aside
          className={`hidden xl:flex xl:flex-col xl:border-r xl:border-gray-200 xl:bg-white xl:z-40 xl:flex-shrink-0 select-none justify-between py-5 transition-all duration-300 ${
            sidebarCollapsed ? "xl:w-16 xl:px-3" : "xl:w-56 xl:px-4"
          }`}
        >
          <div className="flex flex-col gap-3">
            {/* Collapse toggle button */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="flex items-center justify-center w-10 h-10 rounded-xl text-text-secondary hover:bg-gray-100 hover:text-text-main transition-all cursor-pointer self-end mb-2"
              title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
              aria-label={sidebarCollapsed ? "Expandir menu de navegação" : "Recolher menu de navegação"}
              aria-expanded={!sidebarCollapsed}
              aria-controls="navegacao-desktop"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-5 h-5" />
              ) : (
                <PanelLeftClose className="w-5 h-5" />
              )}
            </button>

            {/* Navigation Tabs — icons always visible, labels only when expanded */}
            <nav id="navegacao-desktop" aria-label="Navegação principal" className="flex flex-col gap-1">
              <button
                onClick={() => handleSetActiveTab("home")}
                className={`flex items-center gap-3 py-3 rounded-xl font-extrabold text-sm transition-all cursor-pointer ${
                  sidebarCollapsed ? "justify-center px-2" : "px-3"
                } ${
                  activeTab === "home"
                    ? "bg-brand-light text-brand"
                    : "text-text-secondary hover:bg-gray-50 hover:text-text-main"
                }`}
                title="Explorar"
              >
                <Map className={`w-5 h-5 flex-shrink-0 ${activeTab === "home" ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
                {!sidebarCollapsed && <span>Explorar</span>}
              </button>

              {/* Trilhas — hidden while TRAILS_ENABLED is false */}
              {TRAILS_ENABLED && (
              <button
                onClick={() => handleSetActiveTab("trails")}
                className={`flex items-center gap-3 py-3 rounded-xl font-extrabold text-sm transition-all cursor-pointer ${
                  sidebarCollapsed ? "justify-center px-2" : "px-3"
                } ${
                  activeTab === "trails"
                    ? "bg-brand-light text-brand"
                    : "text-text-secondary hover:bg-gray-50 hover:text-text-main"
                }`}
                title="Trilhas"
              >
                <Route className={`w-5 h-5 flex-shrink-0 ${activeTab === "trails" ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
                {!sidebarCollapsed && <span>Trilhas</span>}
              </button>
              )}

              <button
                onClick={() => handleSetActiveTab("voice")}
                className={`flex items-center gap-3 py-3 rounded-xl font-extrabold text-sm transition-all cursor-pointer ${
                  sidebarCollapsed ? "justify-center px-2" : "px-3"
                } ${
                  activeTab === "voice"
                    ? "bg-brand-light text-brand"
                    : "text-text-secondary hover:bg-gray-50 hover:text-text-main"
                }`}
                title="Voz"
              >
                <Sparkles className={`w-5 h-5 flex-shrink-0 ${activeTab === "voice" ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
                {!sidebarCollapsed && <span>Voz</span>}
              </button>
            </nav>
          </div>

          {/* User profile / Auth button footer in sidebar */}
          <div className="pt-3 mt-auto border-t border-gray-200/80">
            {isAnonymous ? (
              <button
                onClick={() => handleSetActiveTab("profile")}
                className={`w-full flex items-center gap-3 py-3 rounded-xl font-extrabold text-sm transition-all cursor-pointer ${
                  sidebarCollapsed ? "justify-center px-2" : "px-3"
                } ${
                  activeTab === "profile"
                    ? "bg-brand-light text-brand"
                    : "text-text-secondary hover:bg-gray-50 hover:text-text-main"
                }`}
                title="Entrar ou Criar Conta"
              >
                <LogIn className={`w-5 h-5 flex-shrink-0 ${activeTab === "profile" ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
                {!sidebarCollapsed && <span>Entrar</span>}
              </button>
            ) : user ? (
              <button
                onClick={() => handleSetActiveTab("profile")}
                className={`w-full flex items-center gap-3 py-2.5 rounded-xl font-extrabold text-sm transition-all cursor-pointer ${
                  sidebarCollapsed ? "justify-center px-2" : "px-3"
                } ${
                  activeTab === "profile"
                    ? "bg-brand-light text-brand"
                    : "text-text-secondary hover:bg-gray-50 hover:text-text-main"
                }`}
                title="Meu Perfil"
              >
                <div className="w-7 h-7 rounded-full bg-brand-light text-brand flex items-center justify-center font-black text-xs flex-shrink-0">
                  {user.email?.charAt(0).toUpperCase() || "U"}
                </div>
                {!sidebarCollapsed && (
                  <div className="flex flex-col min-w-0 flex-1 text-left">
                    <span className="text-xs font-black text-text-main truncate">
                      {user.user_metadata?.full_name || user.email?.split("@")[0] || "Visitante"}
                    </span>
                    <span className="text-[10px] font-semibold text-text-secondary truncate">{user.email}</span>
                  </div>
                )}
              </button>
            ) : null}
          </div>
        </aside>

        <div id="conteudo-principal" tabIndex={-1} className="flex-1 relative overflow-hidden">
          {/* Single Map Layer — ALWAYS mounted in background for both mobile & desktop */}
          <div className="w-full h-full relative">
            {/* SearchBar and Category Tags (Visible on PC always, on Mobile ONLY when on "home" tab) */}
            {(activeTab === "home" || isDesktop) && (
              <>
                <SearchBar
                  points={filteredPoints}
                  onSelectPoint={handleSelectPointFromMapOrSearch}
                  onSelectAddress={handleSelectAddress}
                  onOpenScanner={() => {
                    setScanOrigin("map");
                    setIsScannerOpen(true);
                  }}
                  selectedPointId={selectedPoint?.id}
                />

                <div className="absolute top-[calc(env(safe-area-inset-top)+84px)] left-0 right-0 z-40 overflow-x-auto no-scrollbar flex gap-2 px-4 md:px-6 py-1 justify-start xl:top-4 xl:left-[400px] xl:right-auto xl:max-w-[calc(100vw-680px)]">
                  {CATEGORIES.map((cat) => {
                    const isSelected =
                      cat === "Todos" ? selectedCategory === null : selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat === "Todos" ? null : cat)}
                        className={`flex items-center gap-1.5 px-4.5 py-2.5 rounded-full text-xs font-bold tracking-wide shadow-md border transition-all flex-shrink-0 active:scale-95 cursor-pointer ${
                          isSelected
                            ? "bg-brand border-brand text-white"
                            : "bg-white border-gray-150 text-text-main hover:bg-gray-50"
                        }`}
                      >
                        {getCategoryIcon(cat)}
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <CustomMap
              points={filteredPoints}
              selectedPoint={selectedPoint}
              onSelectPoint={handleSelectPointFromMapOrSearch}
              userLocation={userLocation}
              flyToCoords={flyToCoords}
              reduceMotion={reduceMotion}
            />

            {/* Recenter Button — lowered closer to BottomNav since ExploreBottomSheet is temporarily disabled */}
            <button
              onClick={handleRecenter}
              className="absolute bottom-20 right-5 z-40 w-13 h-13 rounded-full bg-white text-brand shadow-xl border border-gray-100/50 flex items-center justify-center hover:bg-gray-50 transition-all active:scale-90 xl:bottom-6 xl:right-6 xl:w-12 xl:h-12"
              title="Centralizar na minha localização"
            >
              <Navigation className="w-6 h-6 stroke-[2.3]" />
            </button>

            {/* Sugerir um local — discreet text link, clearly separated below
                the recenter button so they don't crowd each other on
                narrow/short screens. On desktop it sits right next to the
                recenter button (same row, same vertical center) instead of
                being pushed down toward the bottom edge. */}
            <button
              onClick={() => setIsSuggestSheetOpen(true)}
              className="absolute bottom-6 right-5 z-40 text-[11px] font-bold text-text-secondary bg-white/90 px-3 py-1.5 rounded-full shadow-sm hover:text-brand underline underline-offset-2 decoration-gray-300 hover:decoration-brand transition-colors xl:bottom-6 xl:right-[76px] xl:top-auto"
            >
              Sugerir um local
            </button>

            <BottomSheet
              point={selectedPoint}
              onClose={() => setSelectedPoint(null)}
              onViewDetails={handleViewDetails}
            />

            {/* Mounted here (inside the map's relative container), not as a
                top-level sibling of BottomNav — same reasoning as
                BottomSheet above: its "absolute bottom-0" then resolves
                against this container, which ends where BottomNav begins
                (flex siblings), so it sits ON TOP of the nav bar without
                covering it. Moving it outside this div made it cover
                BottomNav instead. */}
            <SuggestLocationSheet
              isOpen={isSuggestSheetOpen}
              onClose={() => setIsSuggestSheetOpen(false)}
            />
          </div>

          {/* Mobile & Tablet Fullscreen Tab Overlay (Instant switching without page transitions, covers < 1280px) */}
          <div className="block xl:hidden absolute inset-0 z-40 pointer-events-none">
            {activeTab === "home" ? (
              <div className="w-full h-full pointer-events-none" />
            ) : TRAILS_ENABLED && activeTab === "trails" ? (
              <div className="absolute inset-0 z-40 bg-bg-app overflow-y-auto no-scrollbar pointer-events-auto">
                <TrailsView
                  points={points}
                  onSelectPointFromTrail={(point) => {
                    setActiveTab("home");
                    handleSelectPointFromMapOrSearch(point);
                  }}
                  onOpenScanner={() => {
                    setScanOrigin("trail");
                    setIsScannerOpen(true);
                  }}
                  refreshKey={trailsRefreshKey}
                  autoOpenCity={voiceRequestedCity}
                />
              </div>
            ) : activeTab === "voice" ? (
              <div className="absolute inset-0 z-40 bg-bg-app overflow-y-auto overflow-x-hidden no-scrollbar pointer-events-auto">
                <VoiceView
                  userId={user?.id || ""}
                  points={points}
                  searchedPoints={searchedPoints}
                  userLocation={userLocation}
                  goToPoint={(point) => {
                    setActiveTab("home");
                    handleSelectPointFromMapOrSearch(point);
                  }}
                  goToTrailsForCity={(city) => {
                    setVoiceRequestedCity(city);
                    setActiveTabSafe("trails");
                  }}
                  goToTrails={() => {
                    setVoiceRequestedCity(null);
                    setActiveTabSafe("trails");
                  }}
                  goToMap={() => setActiveTab("home")}
                  goToProfile={() => setActiveTab("profile")}
                  openScanner={() => {
                    setScanOrigin("map");
                    setIsScannerOpen(true);
                  }}
                  setHighContrast={handleSetHighContrast}
                  setVLibras={handleSetVLibrasActive}
                  setVoiceReading={handleSetVoiceActive}
                  setReduceMotion={handleSetReduceMotion}
                  increaseFontScale={handleIncreaseFontScale}
                  decreaseFontScale={handleDecreaseFontScale}
                />
              </div>
            ) : (
              <div className="absolute inset-0 z-40 bg-bg-app overflow-y-auto no-scrollbar pointer-events-auto">
                <ProfileView
                  searchedPoints={searchedPoints}
                  onSelectPoint={(point) => setActiveDetailsPoint(point)}
                />
              </div>
            )}
          </div>
        </div>

        <BottomNav activeTab={activeTab} setActiveTab={setActiveTabSafe} />

        {/* ExploreBottomSheet is temporarily disabled per user request */}

        {/* Desktop side sheets for Trails / Voice / Profile — slide from left, over sidebar (z-[60]) */}
        <AnimatePresence>
          {activeTab !== "home" && (
            <motion.div
              key={`desktop-sidesheet-${activeTab}`}
              initial={reduceMotion ? { x: 0 } : { x: "-100%" }}
              animate={{ x: 0 }}
              exit={reduceMotion ? { x: 0 } : { x: "-100%" }}
              transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 32, stiffness: 280 }}
              className="hidden xl:flex xl:flex-col xl:absolute xl:inset-y-0 xl:left-0 xl:w-[390px] xl:z-[60] xl:bg-bg-app xl:border-r xl:border-gray-200 xl:shadow-2xl overflow-y-auto no-scrollbar"
            >
              {/* Clean Close X Button */}
              <button
                onClick={() => handleSetActiveTab("home")}
                className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-white border border-gray-200 shadow-md text-text-secondary hover:text-text-main hover:bg-gray-50 flex items-center justify-center transition-all cursor-pointer"
                title="Fechar e voltar ao mapa"
              >
                <X className="w-5 h-5" />
              </button>

              <AnimatePresence mode="wait">
                {TRAILS_ENABLED && activeTab === "trails" ? (
                  <motion.div key="dt-trails" className="w-full min-h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    <TrailsView
                      points={points}
                      onSelectPointFromTrail={(point) => {
                        setActiveTab("home");
                        handleSelectPointFromMapOrSearch(point);
                      }}
                      onOpenScanner={() => {
                        setScanOrigin("trail");
                        setIsScannerOpen(true);
                      }}
                      refreshKey={trailsRefreshKey}
                      autoOpenCity={voiceRequestedCity}
                    />
                  </motion.div>
                ) : activeTab === "voice" ? (
                  <motion.div key="dt-voice" className="w-full min-h-full flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    <VoiceView
                      userId={user?.id || ""}
                      points={points}
                      searchedPoints={searchedPoints}
                      userLocation={userLocation}
                      goToPoint={(point) => {
                        setActiveTab("home");
                        handleSelectPointFromMapOrSearch(point);
                      }}
                      goToTrailsForCity={(city) => {
                        setVoiceRequestedCity(city);
                        setActiveTabSafe("trails");
                      }}
                      goToTrails={() => {
                        setVoiceRequestedCity(null);
                        setActiveTabSafe("trails");
                      }}
                      goToMap={() => setActiveTab("home")}
                      goToProfile={() => setActiveTab("profile")}
                      openScanner={() => {
                        setScanOrigin("map");
                        setIsScannerOpen(true);
                      }}
                      setHighContrast={handleSetHighContrast}
                      setVLibras={handleSetVLibrasActive}
                      setVoiceReading={handleSetVoiceActive}
                      setReduceMotion={handleSetReduceMotion}
                      increaseFontScale={handleIncreaseFontScale}
                      decreaseFontScale={handleDecreaseFontScale}
                    />
                  </motion.div>
                ) : activeTab === "profile" ? (
                  <motion.div key="dt-profile" className="w-full min-h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    <ProfileView
                      searchedPoints={searchedPoints}
                      onSelectPoint={(point) => setActiveDetailsPoint(point)}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {activeDetailsPoint && (
            <PointDetails
              key={activeDetailsPoint.id}
              point={activeDetailsPoint}
              onBack={() => setActiveDetailsPoint(null)}
              voiceActive={voiceActive}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isScannerOpen && (
            <QRCodeScanner
              onClose={() => setIsScannerOpen(false)}
              onScanSuccess={handleScanSuccess}
            />
          )}
        </AnimatePresence>

        {/* Global Floating Accessibility Menu Button and Settings Panel */}
        <AccessibilityMenu
          isHighContrast={isHighContrast}
          setIsHighContrast={handleSetHighContrast}
          fontScale={fontScale}
          setFontScale={handleSetFontScale}
          vLibrasActive={vLibrasActive}
          setVLibrasActive={handleSetVLibrasActive}
          voiceActive={voiceActive}
          setVoiceActive={handleSetVoiceActive}
          reduceMotionActive={reduceMotion}
          setReduceMotionActive={handleSetReduceMotion}
          saturation={saturation}
          setSaturation={handleSetSaturation}
          textSpacing={textSpacing}
          setTextSpacing={handleSetTextSpacing}
          lineHeight={lineHeight}
          setLineHeight={handleSetLineHeight}
          hideImages={hideImages}
          setHideImages={handleSetHideImages}
          dyslexiaMode={dyslexiaMode}
          setDyslexiaMode={handleSetDyslexiaMode}
          onResetSettings={handleResetAccessibility}
        />

        {/* Aviso de cobertura — dentro do container para herdar alto contraste,
            escala de fonte e demais classes da Central de Acessibilidade. */}
        <OutOfAreaNotice
          open={outOfArea.open}
          detectedCity={outOfArea.city}
          onDismiss={dismissOutOfArea}
          onGoToCoverage={goToCoverageArea}
        />
        </MotionConfig>
      </div>
    </main>
  );
}
