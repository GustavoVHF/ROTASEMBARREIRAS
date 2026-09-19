"use client";

import React, { useEffect, useState } from "react";
import { TouristPoint } from "@/types/point";
import { ArrowLeft, MapPin, Accessibility, Volume2, Bookmark, Check, X, HelpCircle, ShieldCheck, Headphones, Video, Images, Play, Pause, Square, Gauge, AlertTriangle, ChevronDown, ChevronUp, Flag, Loader2, Star, Navigation, HeartHandshake } from "lucide-react";
import type { AccessibilityDetail } from "@/types/database";
import { motion, AnimatePresence } from "framer-motion";
import { useSpeechReader, SpeechSegment } from "@/hooks/useSpeechReader";
import { useAuth } from "@/context/AuthContext";
import { fetchRelatosForPoint, createRelato, fetchPointGallery } from "@/services/pointsService";
import type { RelatoWithProfile } from "@/types/database";
import { getSavedNavApp, saveNavApp, openNavigation, NAV_APP_LABELS, type NavApp } from "@/lib/navigation";

interface PointDetailsProps {
  point: TouristPoint;
  onBack: () => void;
  voiceActive: boolean;
}

/** Skeleton block — pulses gray, same shape as real content underneath. */
function SkeletonBlock({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded-2xl animate-pulse ${className}`} />;
}

/**
 * Visual complement to the "N pessoas relataram" text — fills a
 * proportional number of 5 stars based on the share of "está tudo bem"
 * reports among all recent reports considered. Purely additive: the text
 * caption stays exactly as it is, this just sits alongside it for people
 * who read pictographic/symbolic cues more easily. Uses the brand color,
 * not a separate "rating yellow" — same rule as the accessibility chips
 * (no colors outside the design system palette).
 */
function ConditionStars({ okRatio }: { okRatio: number }) {
  const filled = Math.round(Math.max(0, Math.min(1, okRatio)) * 5);
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i < filled ? "text-brand fill-brand" : "text-gray-200 fill-gray-200"}`}
        />
      ))}
    </span>
  );
}

/**
 * The 5 summary chips and their grid spans per breakpoint. Base grid is
 * 6 columns: 2+2+2 on the first row, 3+3 on the second, so nothing is left
 * half-empty. md resets to one column each (5-up — only there is the
 * container wide enough, max-w-2xl), xl uses a 2-column grid with the last
 * chip spanning both.
 */
const ACCESSIBILITY_CHIPS: Array<{
  key: "wheelchair" | "audio" | "braille" | "libras" | "attendance";
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  span: string;
}> = [
  { key: "wheelchair", icon: Accessibility, label: "Rampas", span: "col-span-2 md:col-span-1" },
  { key: "audio", icon: Volume2, label: "Áudio", span: "col-span-2 md:col-span-1" },
  { key: "braille", icon: ShieldCheck, label: "Braille", span: "col-span-2 md:col-span-1" },
  { key: "libras", icon: Bookmark, label: "Libras", span: "col-span-3 md:col-span-1" },
  {
    key: "attendance",
    icon: HeartHandshake,
    label: "Atendimento",
    span: "col-span-3 md:col-span-1 xl:col-span-2",
  },
];

/**
 * Accessibility summary chip (rampa/áudio/braille/libras/atendimento) — plain boolean:
 * orange/brand when the point has the feature, dull gray when it doesn't.
 * No 3rd "unverified" state at this level — that lives in the detail
 * bullet list below (AccessibilityDetailItem).
 */
function AccessibilityChip({
  hasFeature,
  icon: FeatureIcon,
  label,
  className = "",
}: {
  hasFeature: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** Grid span classes, set per breakpoint by ACCESSIBILITY_CHIPS below. */
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col xl:flex-row items-center justify-center xl:gap-2 p-3 rounded-2xl border text-center transition-all ${
        hasFeature
          ? "border-brand-light bg-brand-light/40 text-brand font-bold"
          : "border-gray-100 bg-gray-50 text-gray-300"
      } ${className}`}
    >
      <FeatureIcon className="w-7 h-7 mb-1.5 xl:mb-0 xl:w-6 xl:h-6 flex-shrink-0" />
      {/* Labels never wrap: on the xl sidebar (390px wide) 5 columns left
          "Atendimento" breaking mid-word, so there the chips go horizontal
          and 2-per-row instead. */}
      <span className="text-[10px] xl:text-xs font-black whitespace-nowrap">{label}</span>
    </div>
  );
}

/**
 * One item in the accessibility detail bullet list, with its own 3-state
 * confirmation: "tem" (check, brand color), "nao_tem" (X, also brand
 * color — no red, keeps the app's single-accent palette), "nao_verificado"
 * (question mark badge, neutral gray so it visually reads as "unconfirmed"
 * rather than a settled answer either way).
 */
function AccessibilityDetailItem({ detail }: { detail: AccessibilityDetail }) {
  // "tem" = confirmed, brand color. "nao_tem" and "nao_verificado" both
  // read as dull/disabled gray — "nao_tem" additionally uses an X instead
  // of a "?" to distinguish a confirmed absence from an unconfirmed one.
  const isDull = detail.estado !== "tem";
  const StatusIcon = detail.estado === "tem" ? Check : detail.estado === "nao_tem" ? X : HelpCircle;

  return (
    <li className="flex items-start gap-3.5">
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm ${
          isDull ? "bg-gray-200 text-gray-400" : "bg-brand-light text-brand"
        }`}
      >
        <StatusIcon className="w-4 h-4 stroke-[3]" />
      </span>
      <span className={`text-base leading-relaxed font-semibold ${isDull ? "text-gray-400" : "text-text-secondary"}`}>
        {detail.texto}
      </span>
    </li>
  );
}

function PointDetailsSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="absolute inset-0 bg-bg-app z-50 overflow-hidden flex flex-col pb-24 xl:top-0 xl:left-0 xl:bottom-0 xl:right-auto xl:w-[390px] xl:h-full xl:rounded-none xl:shadow-2xl xl:border-r xl:border-gray-200 xl:pb-6">
      <div className="relative w-full h-80 flex-shrink-0 bg-gray-200 animate-pulse">
        <button
          onClick={onBack}
          className="absolute top-[calc(env(safe-area-inset-top)+16px)] left-6 w-12 h-12 rounded-full bg-white/95 text-brand shadow-lg flex items-center justify-center hover:bg-white transition-all active:scale-90"
          title="Voltar"
        >
          <ArrowLeft className="w-6 h-6 stroke-[2.8]" />
        </button>
      </div>
      <div className="px-6 py-8 flex flex-col gap-8 max-w-md md:max-w-2xl mx-auto w-full">
        <SkeletonBlock className="h-24 w-full" />
        <SkeletonBlock className="h-48 w-full" />
        <SkeletonBlock className="h-64 w-full" />
        <SkeletonBlock className="h-40 w-full" />
      </div>
    </div>
  );
}

export default function PointDetails({ point, onBack, voiceActive }: PointDetailsProps) {
  // Skeleton clears once cover image finishes loading (or errors — never
  // hang forever on broken URL). Rest of point data already arrives in
  // the `point` prop synchronously, so image load is the real async gate.
  const [imageLoaded, setImageLoaded] = useState(false);

  const reader = useSpeechReader();

  // Full screen content, in reading order: name, description, address,
  // accessibility items, history. Each segment gets an id so the
  // currently-playing chunk can be highlighted in the UI below.
  const segments: SpeechSegment[] = [
    { id: "name", text: point.name },
    { id: "description", text: point.description },
    { id: "address", text: point.address ? `Endereço: ${point.address}` : "" },
    {
      id: "accessibility",
      text: point.accessibility.details.length > 0 ? point.accessibility.details.map((d) => d.texto).join(". ") : "",
    },
    { id: "history", text: point.history },
  ].filter((s) => s.text.trim());

  const handlePlay = () => reader.play(segments);

  const handleTogglePlayPause = () => {
    if (reader.status === "idle") handlePlay();
    else if (reader.status === "playing") reader.pause();
    else reader.resume();
  };

  // Stop speech automatically when voz alta is turned off from the menu,
  // or when leaving this screen.
  useEffect(() => {
    if (!voiceActive) reader.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActive]);

  useEffect(() => {
    return () => reader.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setImageLoaded(false);
    if (!point.image) {
      setImageLoaded(true); // no cover image set — skip skeleton wait
      return;
    }
    const img = new window.Image();
    img.src = point.image;
    if (img.complete) {
      setImageLoaded(true);
    } else {
      img.onload = () => setImageLoaded(true);
      img.onerror = () => setImageLoaded(true);
    }
  }, [point.image]);

  const { preferences, user, isAnonymous } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;
  // "Ocultar imagens" (Central de Acessibilidade): the banner and the photo
  // gallery are replaced by text-only equivalents instead of leaving empty
  // boxes behind. Everything else is handled by CSS in globals.css.
  const hideImages = preferences?.hide_images_enabled ?? false;

  // --- Community condition (relatos) ---
  // Local copy so a fresh report updates the indicator immediately without
  // waiting for the 1h points cache to expire. Initialised from the prop.
  const [condition, setCondition] = useState(point.condition ?? null);
  const [relatos, setRelatos] = useState<RelatoWithProfile[] | null>(null);
  const [relatosOpen, setRelatosOpen] = useState(false);
  const [relatosLoading, setRelatosLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTipo, setReportTipo] = useState<"ok" | "problema" | null>(null);
  const [reportTexto, setReportTexto] = useState("");
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [reportError, setReportError] = useState("");

  // --- Photo gallery (Storage bucket pontos-imagens) — VIEW ONLY. Uploads
  // are managed internally (admin uploads directly to the bucket via
  // Supabase dashboard), not exposed to any in-app user. ---
  const [galleryPhotos, setGalleryPhotos] = useState<string[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Reset ALL relato state when the point changes. Without this, opening
  // point A → expanding reports → closing → opening point B shows A's list
  // (stale `relatos` / `relatosOpen` / counts from the previous point).
  useEffect(() => {
    setCondition(point.condition ?? null);
    setRelatos(null);
    setRelatosOpen(false);
    setRelatosLoading(false);
    resetReport();
    setGalleryPhotos(point.gallery.filter(Boolean));
    setLightboxIndex(null);
  }, [point.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the FULL gallery from the Storage folder (pasta_imagens / qr fallback),
  // in addition to the curated galeria_imagens[] already seeded above.
  // Non-fatal — errors just leave the curated list as-is.
  useEffect(() => {
    if (!point.imageFolder) return;
    let cancelled = false;
    setGalleryLoading(true);
    fetchPointGallery(point.imageFolder)
      .then((urls) => {
        if (cancelled) return;
        // Merge with the curated list (dedupe), Storage-listed photos first
        // since that folder is the source of truth for "all photos".
        const merged = [...new Set([...urls, ...point.gallery.filter(Boolean)])];
        setGalleryPhotos(merged);
      })
      .finally(() => {
        if (!cancelled) setGalleryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [point.id, point.imageFolder]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleRelatos = async () => {
    if (relatosOpen) {
      setRelatosOpen(false);
      return;
    }
    setRelatosOpen(true);
    // Always (re)fetch when opening — never trust a cached list from a
    // previous point or a pre-report state. Cheap (one indexed query).
    setRelatosLoading(true);
    try {
      const data = await fetchRelatosForPoint(point.id);
      setRelatos(data);
      // Keep the count fresh too, so the "N pessoas relataram" caption matches
      // reality even if the cached map point is stale.
      const problema = data.filter((r) => r.tipo === "problema").length;
      const ok = data.filter((r) => r.tipo === "ok").length;
      setCondition({ active: problema > ok, problemCount: problema, okCount: ok });
    } catch {
      setRelatos([]);
    } finally {
      setRelatosLoading(false);
    }
  };

  const handleSubmitReport = async () => {
    if (!reportTipo) return;
    if (isAnonymous) {
      setReportError("Entre na sua conta para relatar a condição deste local.");
      setReportStatus("error");
      return;
    }
    setReportStatus("sending");
    setReportError("");
    try {
      await createRelato(point.id, reportTipo, reportTexto || null, user?.id ?? null);
      setReportStatus("sent");
      // Invalidate the 1h points cache so the map + BottomSheet also show the
      // new condition immediately (without it they stay stale until expiry).
      try {
        if (typeof window !== "undefined") localStorage.removeItem("rotas_points_cache");
      } catch {}
      // Re-fetch server truth so the legend stays correct even after the
      // rate limit, a deleted neighbour report, or a stale cached map point.
      // Never trust the local optimistic count alone.
      try {
        const data = await fetchRelatosForPoint(point.id);
        setRelatos(data);
        const problema = data.filter((r) => r.tipo === "problema").length;
        const ok = data.filter((r) => r.tipo === "ok").length;
        setCondition({ active: problema > ok, problemCount: problema, okCount: ok });
      } catch {
        // keep optimistic state as a fallback
        setCondition((c) => {
          const problem = (c?.problemCount ?? 0) + (reportTipo === "problema" ? 1 : 0);
          const ok = (c?.okCount ?? 0) + (reportTipo === "ok" ? 1 : 0);
          return { active: problem > ok, problemCount: problem, okCount: ok };
        });
      }
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Não foi possível enviar. Tente novamente.");
      setReportStatus("error");
    }
  };

  const resetReport = () => {
    setReportOpen(false);
    setReportTipo(null);
    setReportTexto("");
    setReportStatus("idle");
    setReportError("");
  };
  // --- "Como chegar" (directions) ---
  // First tap: show a small inline chooser (Google Maps / Waze), matching
  // the app's lightweight selector pattern (no heavy modal). Choice is
  // saved to localStorage — device preference, not account data, so no
  // Supabase write. Subsequent taps open the saved app directly.
  const [navChooserOpen, setNavChooserOpen] = useState(false);
  // Lazy initializer — reads localStorage once on mount without a
  // synchronous setState-in-effect (avoids an extra render pass).
  const [savedNavApp, setSavedNavApp] = useState<NavApp | null>(() => getSavedNavApp());

  const handleDirectionsClick = () => {
    if (savedNavApp) {
      openNavigation(savedNavApp, point.coords.lat, point.coords.lng);
      return;
    }
    setNavChooserOpen(true);
  };

  const handleChooseNavApp = (app: NavApp) => {
    saveNavApp(app);
    setSavedNavApp(app);
    setNavChooserOpen(false);
    openNavigation(app, point.coords.lat, point.coords.lng);
  };

  // Detect desktop viewport to change slide direction (mobile: from right, desktop: from left)
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (!imageLoaded) {
    return <PointDetailsSkeleton onBack={onBack} />;
  }

  const slideFrom = reduceMotion ? 0 : isDesktop ? "-100%" : "100%";

  return (
    <motion.div
      initial={reduceMotion ? { x: 0 } : { x: slideFrom }}
      animate={{ x: 0 }}
      exit={reduceMotion ? { x: 0 } : { x: slideFrom }}
      transition={reduceMotion ? { duration: 0 } : { type: "spring", damping: 28, stiffness: 220 }}
      className="absolute inset-0 bg-bg-app z-[65] overflow-y-auto no-scrollbar flex flex-col pb-24 xl:top-0 xl:left-0 xl:bottom-0 xl:right-auto xl:w-[390px] xl:h-full xl:rounded-none xl:shadow-2xl xl:border-r xl:border-gray-200 xl:pb-6"
    >
      {/* COMPACT HEADER — used when "Ocultar imagens" is on. The banner below
          carries the back button and the title, so it can't simply be
          display:none'd (the user would lose the way back). Instead the same
          controls are rendered in a slim text-only header, which is also why
          this block is conditional in JSX instead of a CSS rule. */}
      {hideImages ? (
        <div className="w-full flex-shrink-0 bg-white border-b border-gray-100 px-6 pt-[calc(env(safe-area-inset-top)+16px)] pb-5 flex items-start gap-4">
          <button
            onClick={onBack}
            className="w-12 h-12 flex-shrink-0 rounded-full bg-gray-100 text-brand flex items-center justify-center hover:bg-gray-200 transition-all active:scale-90"
            title="Voltar"
          >
            <ArrowLeft className="w-6 h-6 stroke-[2.8]" />
          </button>
          <div className="min-w-0 flex-1">
            <span className="text-xs uppercase font-extrabold tracking-widest text-brand">{point.category}</span>
            <h2
              className={`text-2xl font-black text-text-main mt-1 leading-tight rounded-md transition-colors ${
                reader.currentSegmentId === "name" ? "bg-brand-light" : ""
              }`}
            >
              {point.name}
            </h2>
          </div>
        </div>
      ) : (
        <>
      {/* Top Banner Image */}
      <div className="relative w-full h-80 flex-shrink-0 bg-zinc-800">
        {point.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={point.image}
            alt={point.name}
            className="w-full h-full object-cover opacity-90"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        
        {/* Taller Back Button (w-12 h-12) */}
        <button
          onClick={onBack}
          className="absolute top-[calc(env(safe-area-inset-top)+16px)] left-6 w-12 h-12 rounded-full bg-white/95 text-brand shadow-lg flex items-center justify-center hover:bg-white transition-all active:scale-90"
          title="Voltar"
        >
          <ArrowLeft className="w-6 h-6 stroke-[2.8]" />
        </button>
        
        {/* Title over image - Larger text sizes */}
        <div className="absolute bottom-6 left-6 right-6">
          <span className="text-xs uppercase font-extrabold tracking-widest text-[#FFFFFF] bg-brand px-4 py-2 rounded-full">
            {point.category}
          </span>
          <h2
            className={`text-3xl font-black text-white mt-3.5 drop-shadow-md leading-tight rounded-md transition-colors ${
              reader.currentSegmentId === "name" ? "bg-brand/60" : ""
            }`}
          >
            {point.name}
          </h2>
        </div>
      </div>
        </>
      )}

      {/* Details Container - Increased spacing and text sizes */}
      <div className="px-6 py-8 flex flex-col gap-8 max-w-md md:max-w-2xl mx-auto w-full">
        {/* Address Card - Larger */}
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md flex items-start gap-4">
          <MapPin className="w-6 h-6 text-brand mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h4 className="font-extrabold text-xs uppercase tracking-wider text-text-secondary">Endereço</h4>
            <p
              className={`text-base text-text-main font-semibold mt-1 leading-relaxed rounded-md transition-colors ${
                reader.currentSegmentId === "address" ? "bg-brand-light" : ""
              }`}
            >
              {point.address}
            </p>

            {/* "Como chegar" — opens the saved nav app directly, or shows
                the inline chooser (Google Maps / Waze) on first use. */}
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={handleDirectionsClick}
                className="flex-1 min-w-0 h-11.5 flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white font-bold text-sm rounded-full px-4 transition-colors active:scale-95"
              >
                <Navigation className="w-4.5 h-4.5 flex-shrink-0" />
                <span className="truncate">
                  Como chegar
                  {savedNavApp && (
                    <span className="text-white/80 font-semibold"> · {NAV_APP_LABELS[savedNavApp]}</span>
                  )}
                </span>
              </button>

              {/* Discreet way to change the saved app later, without clearing
                  browser data or reinstalling anything. */}
              {savedNavApp && (
                <button
                  onClick={() => setNavChooserOpen((v) => !v)}
                  className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full bg-gray-100 text-text-secondary hover:bg-gray-150 hover:text-brand transition-colors active:scale-90"
                  title="Trocar app de navegação"
                  aria-label="Trocar app de navegação"
                  aria-expanded={navChooserOpen}
                >
                  {navChooserOpen ? (
                    <ChevronUp className="w-4.5 h-4.5" />
                  ) : (
                    <ChevronDown className="w-4.5 h-4.5" />
                  )}
                </button>
              )}
            </div>

            {/* Inline chooser — same lightweight expand pattern used by the
                report form / relatos list below, no heavy modal. */}
            <AnimatePresence initial={false}>
              {navChooserOpen && (
                <motion.div
                  initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs font-bold text-text-secondary mb-3">
                      Abrir rota com qual aplicativo?
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        onClick={() => handleChooseNavApp("google_maps")}
                        className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl px-4 py-4 border font-bold text-sm transition-all ${
                          savedNavApp === "google_maps"
                            ? "bg-brand text-white border-brand"
                            : "bg-white text-text-main border-gray-200 hover:border-brand/40"
                        }`}
                      >
                        <MapPin className="w-6 h-6" strokeWidth={2.5} />
                        <span className="leading-snug">Google Maps</span>
                      </button>
                      <button
                        onClick={() => handleChooseNavApp("waze")}
                        className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl px-4 py-4 border font-bold text-sm transition-all ${
                          savedNavApp === "waze"
                            ? "bg-brand text-white border-brand"
                            : "bg-white text-text-main border-gray-200 hover:border-brand/40"
                        }`}
                      >
                        <Navigation className="w-6 h-6" strokeWidth={2.5} />
                        <span className="leading-snug">Waze</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Image Gallery — full Storage folder listing (pontos-imagens),
            not just the curated galeria_imagens[]. View-only: photos are
            managed internally via the Supabase Storage bucket, not
            uploaded by end users. */}
        {galleryPhotos.length > 0 && !hideImages && (
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md">
            <h3 className="text-xl font-black text-text-main flex items-center gap-2 border-b border-gray-100 pb-4 mb-5">
              <Images className="w-6 h-6 text-brand" />
              Galeria de Fotos
            </h3>

            {galleryLoading ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm font-bold py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando fotos...
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5">
                {galleryPhotos.map((url, index) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setLightboxIndex(index)}
                    className="aspect-square rounded-2xl overflow-hidden border border-gray-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`${point.name} - foto ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lightbox — simple full-screen viewer with prev/next, no external lib */}
        <AnimatePresence>
          {lightboxIndex !== null && galleryPhotos[lightboxIndex] && (
            <motion.div
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.15 }}
              className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center"
              onClick={() => setLightboxIndex(null)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={galleryPhotos[lightboxIndex]}
                alt={`${point.name} - foto ${lightboxIndex + 1}`}
                className="max-w-full max-h-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => setLightboxIndex(null)}
                className="absolute top-[calc(env(safe-area-inset-top)+16px)] right-6 w-11 h-11 rounded-full bg-white/95 text-text-main shadow-lg flex items-center justify-center active:scale-90"
                title="Fechar"
              >
                <X className="w-5 h-5 stroke-[2.8]" />
              </button>
              {galleryPhotos.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxIndex((i) => (i === null ? null : (i - 1 + galleryPhotos.length) % galleryPhotos.length));
                    }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/95 text-text-main shadow-lg flex items-center justify-center active:scale-90"
                    title="Foto anterior"
                  >
                    <ArrowLeft className="w-5 h-5 stroke-[2.8]" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxIndex((i) => (i === null ? null : (i + 1) % galleryPhotos.length));
                    }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/95 text-text-main shadow-lg flex items-center justify-center active:scale-90"
                    title="Próxima foto"
                  >
                    <ArrowLeft className="w-5 h-5 stroke-[2.8] rotate-180" />
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Accessibility Features Section - Larger and easier to read */}
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md">
          <h3 className="text-xl font-black text-text-main flex items-center gap-2 border-b border-gray-100 pb-4 mb-5">
            <Accessibility className="w-6 h-6 text-brand" />
            Acessibilidade no Local
          </h3>

          {/* Quick Icons - Larger grid elements. Each chip shows a small
              corner badge for the 3-state rating (tem / não tem / não
              verificado) — see AccessibilityChip above. */}
          {/* 5 chips over a 6-column base grid, so the second row stretches
              to fill the width instead of leaving a hole:
                mobile  -> 3 chips (span 2) + 2 chips (span 3)
                md      -> 5 equal columns (container widens to max-w-2xl)
                xl      -> 2 columns of horizontal chips, last one full width
                           (the detail panel is only 390px wide on desktop,
                           where 5 columns broke the "Atendimento" label) */}
          <div className="grid grid-cols-6 md:grid-cols-5 xl:grid-cols-2 gap-2.5 mb-6">
            {ACCESSIBILITY_CHIPS.map(({ key, icon, label, span }) => (
              <AccessibilityChip
                key={key}
                hasFeature={point.accessibility[key]}
                icon={icon}
                label={label}
                className={span}
              />
            ))}
          </div>

          {/* Last-updated caption (from public.pontos.atualizado_em) */}
          {point.updatedAt && (
            <p className="text-[11px] font-bold text-text-secondary/70 mb-6 -mt-3">
              Informações atualizadas em{" "}
              {new Date(point.updatedAt).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </p>
          )}

          {/* Bulleted details - text-base for high readability */}
          <ul
            className={`space-y-4 rounded-xl transition-colors ${
              reader.currentSegmentId === "accessibility" ? "bg-brand-light/50 -m-2 p-2" : ""
            }`}
          >
            {point.accessibility.details.map((detail, index) => (
              <AccessibilityDetailItem key={index} detail={detail} />
            ))}
          </ul>

          {/* Accessibility media links — rendered only when cadastro provides the URL */}
          {(point.audioUrl || point.audioDescriptionUrl || point.librasVideoUrl) && (
            <div className="mt-6 pt-5 border-t border-gray-100 flex flex-col gap-3">
              {point.audioUrl && (
                <a
                  href={point.audioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 bg-brand-light/40 hover:bg-brand-light text-brand font-bold text-sm rounded-2xl px-5 py-4 transition-colors"
                >
                  <Headphones className="w-5 h-5" />
                  Ouvir Áudio do Local
                </a>
              )}
              {point.audioDescriptionUrl && (
                <a
                  href={point.audioDescriptionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 bg-brand-light/40 hover:bg-brand-light text-brand font-bold text-sm rounded-2xl px-5 py-4 transition-colors"
                >
                  <Volume2 className="w-5 h-5" />
                  Ouvir Audiodescrição
                </a>
              )}
              {point.librasVideoUrl && (
                <a
                  href={point.librasVideoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 bg-brand-light/40 hover:bg-brand-light text-brand font-bold text-sm rounded-2xl px-5 py-4 transition-colors"
                >
                  <Video className="w-5 h-5" />
                  Assistir Vídeo em Libras
                </a>
              )}
            </div>
          )}

          {/* Report link — discreet secondary text, opens the inline form */}
          <button
            onClick={() => (reportOpen ? resetReport() : setReportOpen(true))}
            className="mt-6 pt-5 border-t border-gray-100 w-full text-left flex items-center gap-2 text-text-secondary hover:text-brand transition-colors group"
          >
            <Flag className="w-4 h-4 text-text-secondary group-hover:text-brand transition-colors" />
            <span className="text-sm font-bold underline underline-offset-2 decoration-gray-300 group-hover:decoration-brand">
              Encontrou algo diferente? Avise aqui
            </span>
          </button>

          {/* Inline report form (no new screen) */}
          <AnimatePresence initial={false}>
            {reportOpen && (
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-4 bg-gray-50 rounded-2xl p-5 border border-gray-100">
                  {reportStatus === "sent" ? (
                    <div className="flex flex-col items-center text-center gap-3 py-2">
                      <span className="w-11 h-11 rounded-full bg-brand-light text-brand flex items-center justify-center">
                        <Check className="w-6 h-6 stroke-[2.5]" />
                      </span>
                      <p className="text-base font-bold text-text-main">Obrigado! Seu relato ajuda a comunidade.</p>
                      <button onClick={resetReport} className="text-sm font-bold text-text-secondary underline underline-offset-2">
                        Fechar
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-text-main mb-3">Como está este local agora?</p>
                      <div className="grid grid-cols-2 gap-2.5 mb-4">
                        <button
                          onClick={() => setReportTipo("ok")}
                          className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl px-4 py-4 border font-bold text-sm transition-all ${
                            reportTipo === "ok"
                              ? "bg-brand text-white border-brand"
                              : "bg-white text-text-main border-gray-200 hover:border-brand/40"
                          }`}
                        >
                          <Check className="w-6 h-6" strokeWidth={2.5} />
                          <span className="leading-snug">Está tudo bem</span>
                        </button>
                        <button
                          onClick={() => setReportTipo("problema")}
                          className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl px-4 py-4 border font-bold text-sm transition-all ${
                            reportTipo === "problema"
                              ? "bg-brand text-white border-brand"
                              : "bg-white text-text-main border-gray-200 hover:border-brand/40"
                          }`}
                        >
                          <AlertTriangle className="w-6 h-6" strokeWidth={2.5} />
                          <span className="leading-snug">Encontrei um problema</span>
                        </button>
                      </div>

                      {reportTipo === "problema" && (
                        <textarea
                          value={reportTexto}
                          onChange={(e) => setReportTexto(e.target.value)}
                          maxLength={280}
                          rows={3}
                          placeholder="Descreva o problema (opcional)"
                          className="w-full mb-4 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-text-main placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
                        />
                      )}

                      {reportStatus === "error" && (
                        <p className="text-sm font-bold text-brand mb-3">{reportError}</p>
                      )}

                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={handleSubmitReport}
                          disabled={!reportTipo || reportStatus === "sending"}
                          className="flex-1 flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-full py-3.5 transition-colors active:scale-95"
                        >
                          {reportStatus === "sending" ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Enviando...
                            </>
                          ) : (
                            "Enviar relato"
                          )}
                        </button>
                        <button
                          onClick={resetReport}
                          className="px-4 py-3.5 rounded-full text-sm font-bold text-text-secondary hover:bg-gray-100 transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Community condition section — ALWAYS visible. When there are no
            recent reports, it invites the first report instead of hiding.
            When reports exist, icon reflects the majority (✓ ok / ⚠ problema). */}
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md">
          <button
            onClick={handleToggleRelatos}
            className="w-full flex items-center justify-between gap-3 text-left"
            aria-expanded={relatosOpen}
          >
            <h3 className="text-lg font-black text-text-main flex items-center gap-2">
              {condition?.active ? (
                <AlertTriangle className="w-5 h-5 text-brand" />
              ) : (
                <span className="w-5 h-5 rounded-full bg-brand-light text-brand flex items-center justify-center">
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                </span>
              )}
              Condição recente
            </h3>
            {relatosOpen ? (
              <ChevronUp className="w-5 h-5 text-text-secondary" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-secondary" />
            )}
          </button>

          <div className="mt-4">
            {condition && (condition.problemCount > 0 || condition.okCount > 0) ? (
              (() => {
                const total = condition.problemCount + condition.okCount;
                const okRatio = condition.okCount / total;
                return (
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <p className="text-sm text-text-secondary font-bold">
                      {total} {total === 1 ? "pessoa relatou" : "pessoas relataram"} nos últimos dias
                    </p>
                    <span
                      role="img"
                      aria-label={`Avaliação: ${Math.round(okRatio * 5)} de 5 estrelas, baseada na proporção de relatos positivos`}
                    >
                      <ConditionStars okRatio={okRatio} />
                    </span>
                  </div>
                );
              })()
            ) : (
              <p className="text-sm text-text-secondary font-bold">
                Sem relatos recentes. Você pode ser o primeiro a avaliar este local.
              </p>
            )}
          </div>

          <AnimatePresence initial={false}>
            {relatosOpen && (
              <motion.div
                initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                  {relatosLoading ? (
                    <div className="flex items-center gap-2 text-text-secondary text-sm font-bold">
                      <Loader2 className="w-4 h-4 animate-spin" /> Carregando relatos...
                    </div>
                  ) : relatos && relatos.length > 0 ? (
                    relatos.map((r) => (
                      <div key={r.id} className="flex items-start gap-3">
                        {/* Reporter avatar — real photo when available, generic otherwise */}
                        {r.reporter_avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.reporter_avatar}
                            alt={r.reporter_name}
                            className="w-9 h-9 rounded-full object-cover border border-gray-100 shrink-0"
                          />
                        ) : (
                          <span className="w-9 h-9 rounded-full bg-brand-light text-brand flex items-center justify-center font-black text-xs shrink-0">
                            {r.reporter_name.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-black text-text-main truncate">{r.reporter_name}</p>
                            {r.tipo === "problema" ? (
                              <AlertTriangle className="w-4 h-4 text-brand shrink-0" />
                            ) : (
                              <Check className="w-4 h-4 text-brand shrink-0" />
                            )}
                          </div>
                          {r.tipo === "problema" ? (
                            r.texto && r.texto.trim() ? (
                              <p className="text-sm text-text-main font-semibold leading-relaxed mt-0.5">{r.texto}</p>
                            ) : (
                              <p className="text-sm text-text-secondary font-semibold italic mt-0.5">Relatou um problema</p>
                            )
                          ) : (
                            <p className="text-sm text-text-secondary font-semibold mt-0.5">Confirmou que está tudo bem</p>
                          )}
                          <p className="text-[11px] text-text-secondary font-bold mt-1">
                            {new Date(r.criado_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-text-secondary font-semibold">Nenhum relato detalhado ainda.</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* History / Culture Section - text-base size */}
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md">
          <h3 className="text-xl font-black text-text-main border-b border-gray-100 pb-4 mb-5">
            História & Importância
          </h3>
          <p
            className={`text-base text-text-secondary leading-relaxed font-semibold whitespace-pre-line rounded-md transition-colors ${
              reader.currentSegmentId === "history" ? "bg-brand-light" : ""
            }`}
          >
            {point.history}
          </p>
        </div>
      </div>

      {/* Read-aloud controls — only rendered when Voz Alta is enabled in the
          accessibility menu. Manual play/pause/stop + speed, never
          auto-starts; user must tap play. Fixed above the bottom safe area
          so it stays reachable while scrolling long detail content. */}
      {voiceActive && (
      <div className="fixed bottom-0 left-0 right-0 max-w-md md:max-w-2xl mx-auto px-6 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4 pointer-events-none xl:left-0 xl:right-auto xl:w-[390px] xl:max-w-none">
        <div className="bg-white/95 backdrop-blur-md border border-gray-150 shadow-xl rounded-full px-4 py-3 flex items-center gap-2 pointer-events-auto">
          <button
            onClick={handleTogglePlayPause}
            className="w-11 h-11 rounded-full bg-brand text-white flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
            title={reader.status === "playing" ? "Pausar leitura" : "Ouvir descrição"}
          >
            {reader.status === "playing" ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5" />
            )}
          </button>

          <button
            onClick={reader.stop}
            disabled={reader.status === "idle"}
            className="w-11 h-11 rounded-full bg-gray-100 text-text-secondary flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform disabled:opacity-40"
            title="Parar leitura"
          >
            <Square className="w-4.5 h-4.5" />
          </button>

          <div className="h-7 w-[1.5px] bg-gray-200 flex-shrink-0" />

          <button
            onClick={() => reader.cycleRate("down")}
            disabled={reader.rate === reader.rateSteps[0]}
            className="w-9 h-9 rounded-full bg-gray-100 text-text-main flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform disabled:opacity-40 text-xs font-black"
            title="Mais lento"
          >
            −
          </button>
          <div className="flex items-center gap-1 min-w-[46px] justify-center flex-shrink-0">
            <Gauge className="w-3.5 h-3.5 text-text-secondary" />
            <span className="text-xs font-bold text-text-secondary">{reader.rate}x</span>
          </div>
          <button
            onClick={() => reader.cycleRate("up")}
            disabled={reader.rate === reader.rateSteps[reader.rateSteps.length - 1]}
            className="w-9 h-9 rounded-full bg-gray-100 text-text-main flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform disabled:opacity-40 text-xs font-black"
            title="Mais rápido"
          >
            +
          </button>

          <span className="text-xs font-bold text-text-secondary truncate ml-1">
            {reader.status === "idle" && "Ouvir descrição"}
            {reader.status === "playing" && "Lendo..."}
            {reader.status === "paused" && "Pausado"}
          </span>
        </div>
      </div>
      )}
    </motion.div>
  );
}
