"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, useMotionValue, useDragControls } from "framer-motion";
import {
  Contrast,
  Volume2,
  Type,
  ArrowLeft,
  Check,
  ZapOff,
  Palette,
  MoveHorizontal,
  StretchVertical,
  ImageOff,
  BookOpen,
  RotateCcw,
} from "lucide-react";
// FaUniversalAccess = the current international "Accessible Icon"/UN
// accessibility symbol (person with outstretched arms inside a circle),
// from react-icons' bundled Font Awesome set — a real, maintained icon
// library instead of a hand-drawn SVG.
import { FaUniversalAccess } from "react-icons/fa6";
import {
  FONT_SCALE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  SATURATION_OPTIONS,
  TEXT_SPACING_OPTIONS,
  type ColorSaturation,
  type FontScale,
  type LineHeightPref,
  type TextSpacing,
} from "@/lib/accessibility";

interface AccessibilityMenuProps {
  isHighContrast: boolean;
  setIsHighContrast: (v: boolean) => void;
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  vLibrasActive?: boolean;
  setVLibrasActive?: (v: boolean) => void;
  voiceActive: boolean;
  setVoiceActive: (v: boolean) => void;
  reduceMotionActive: boolean;
  setReduceMotionActive: (v: boolean) => void;
  // --- Recursos visuais e de leitura ---
  saturation: ColorSaturation;
  setSaturation: (v: ColorSaturation) => void;
  textSpacing: TextSpacing;
  setTextSpacing: (v: TextSpacing) => void;
  lineHeight: LineHeightPref;
  setLineHeight: (v: LineHeightPref) => void;
  hideImages: boolean;
  setHideImages: (v: boolean) => void;
  dyslexiaMode: boolean;
  setDyslexiaMode: (v: boolean) => void;
  /** Restaura TODAS as configurações desta central para o padrão. */
  onResetSettings: () => void;
}

// Persisted position storage key for the draggable accessibility button.
const DRAG_POSITION_STORAGE_KEY = "accessibility-btn-position";
// Approximate button footprint (w-13/h-13 = 52px) used to keep it clamped on screen.
const BUTTON_SIZE = 52;
// Minimum pointer displacement (px) before a press is treated as a drag
// instead of a click. Framer Motion's own tap gesture uses a 3px threshold
// to tell a tap from a drag/pan; we use a slightly larger one (10px) since
// this app targets elderly/motor-impaired users whose taps naturally wobble
// a few pixels while pressing. A time-based "hold to drag" delay was tried
// first but real presses routinely last longer than any short delay, so it
// kept mis-firing as a drag on ordinary clicks — displacement, not time, is
// the correct signal here.
const DRAG_ARM_THRESHOLD_PX = 10;

/** Theme-dependent class strings, computed once per render and handed to the
 * presentational pieces below (which live at module scope so they aren't
 * re-created on every render). */
interface PanelTheme {
  isHighContrast: boolean;
  reduceMotion: boolean;
  cardBg: string;
  iconBoxBg: string;
  activeBg: string;
  inactiveBg: string;
}

/** Card shell — the look every setting shares (icon box + title + text). */
function SettingCard({
  icon: Icon,
  title,
  description,
  theme,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  theme: PanelTheme;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-3xl p-5 flex flex-col gap-4 ${theme.cardBg}`}>
      <div className="flex items-start gap-3.5 min-w-0">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${theme.iconBoxBg}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <h3 className="font-black text-base leading-snug">{title}</h3>
          <p className="text-xs text-text-secondary font-medium mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 pt-2 border-t border-gray-100/80">{children}</div>
    </div>
  );
}

/** Status line + switch, for the on/off settings. */
function ToggleRow({
  active,
  onToggle,
  label,
  theme,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
  theme: PanelTheme;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-text-secondary">
        Status:{" "}
        <strong className={active ? (theme.isHighContrast ? "text-yellow-400" : "text-brand") : ""}>
          {active ? "Ativado" : "Desativado"}
        </strong>
      </span>
      <button
        data-active={active}
        onClick={onToggle}
        className={`accessibility-toggle-track w-14 h-8 rounded-full relative transition-colors duration-200 cursor-pointer flex-shrink-0 p-1 ${
          active ? theme.activeBg : theme.inactiveBg
        }`}
        aria-label={label}
        aria-pressed={active}
      >
        <motion.div
          layout
          className="accessibility-toggle-thumb w-6 h-6 rounded-full shadow-md bg-white"
          animate={{ x: active ? 24 : 0 }}
          transition={theme.reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  );
}

/** Segmented selector for the multi-option settings (escala, saturação,
 * espaçamento, altura da linha). Same pill grid the font scale already used,
 * so nothing looks bolted on. */
function OptionGroup<T extends string>({
  options,
  value,
  onChange,
  groupLabel,
  theme,
  columns = 3,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  groupLabel: string;
  theme: PanelTheme;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      className={`grid gap-2 ${
        columns === 4 ? "grid-cols-2 sm:grid-cols-4" : columns === 2 ? "grid-cols-2" : "grid-cols-3"
      }`}
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={`py-2 px-3 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-1 cursor-pointer border ${
              isSelected
                ? theme.isHighContrast
                  ? "bg-yellow-400 border-white text-black"
                  : "bg-brand border-brand text-white shadow-md"
                : theme.isHighContrast
                  ? "bg-zinc-900 border-zinc-700 text-white"
                  : "bg-gray-100 border-gray-200 text-text-secondary hover:bg-gray-150"
            }`}
          >
            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3] flex-shrink-0" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AccessibilityMenu({
  isHighContrast,
  setIsHighContrast,
  fontScale,
  setFontScale,
  voiceActive,
  setVoiceActive,
  reduceMotionActive,
  setReduceMotionActive,
  saturation,
  setSaturation,
  textSpacing,
  setTextSpacing,
  lineHeight,
  setLineHeight,
  hideImages,
  setHideImages,
  dyslexiaMode,
  setDyslexiaMode,
  onResetSettings,
}: AccessibilityMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Inline confirmation for "Restaurar configurações" — never a native alert
  // (see the anti-alert rule in AGENTS.md).
  const [justReset, setJustReset] = useState(false);

  // Open accessibility menu by default on mobile on first load
  useEffect(() => {
    const isFirstVisit = !window.localStorage.getItem("accessibility-menu-viewed");
    if (isFirstVisit && typeof window !== "undefined") {
      const isMobile = window.innerWidth < 1280; // xl breakpoint
      if (isMobile) {
        setIsOpen(true);
        window.localStorage.setItem("accessibility-menu-viewed", "true");
      }
    }
  }, []);

  const safeScale = FONT_SCALE_OPTIONS.some((o) => o.value === fontScale) ? fontScale : "normal";

  // Draggable floating button: offsets are applied on top of the default
  // CSS position (left-4/top-[38%] on mobile). Desktop uses a separate,
  // non-draggable button pinned to the top-right corner.
  const dragBoundsRef = useRef<HTMLDivElement>(null);
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const wasDraggedRef = useRef(false);
  const dragControls = useDragControls();
  // Origin point of the current press, used to measure displacement before
  // deciding whether this gesture is a drag or a click.
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dragArmedRef = useRef(false);

  // Restore a previously saved position (clamped to the current viewport
  // in case the window was resized since it was last saved).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(DRAG_POSITION_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { x: number; y: number };
      if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return;
      const maxX = window.innerWidth - BUTTON_SIZE;
      const maxY = window.innerHeight - BUTTON_SIZE;
      dragX.set(Math.min(Math.max(parsed.x, -maxX), maxX));
      dragY.set(Math.min(Math.max(parsed.y, -maxY), maxY));
    } catch {
      // Ignore malformed/unavailable storage; falls back to default position.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-hides the "Configurações restauradas" line.
  useEffect(() => {
    if (!justReset) return;
    const timer = setTimeout(() => setJustReset(false), 3000);
    return () => clearTimeout(timer);
  }, [justReset]);

  const handleDragEnd = () => {
    try {
      window.localStorage.setItem(
        DRAG_POSITION_STORAGE_KEY,
        JSON.stringify({ x: dragX.get(), y: dragY.get() })
      );
    } catch {
      // Ignore storage failures (e.g. private browsing mode).
    }
  };

  const handleButtonClick = () => {
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }
    setIsOpen(true);
  };

  // Displacement-based drag arming: record where the press started, then
  // only hand the gesture to Framer Motion's drag controller once the
  // pointer has actually moved past DRAG_ARM_THRESHOLD_PX. Until that
  // happens the press is indistinguishable from a click, so onClick is left
  // free to fire normally — no timer, no guessing how long a "real" press
  // should take.
  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    pressOriginRef.current = { x: event.clientX, y: event.clientY };
    dragArmedRef.current = false;
    // Every new press starts clean, so a swallowed click from a previous drag
    // can never leak into the next real click.
    wasDraggedRef.current = false;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragArmedRef.current) return;

    // DESKTOP FIX: with a mouse, pointermove also fires on plain hover.
    // `buttons === 0` means no button is held, so this is hover, never a drag.
    // Without this check a press origin left over from an earlier gesture
    // (pointerup released outside the button, so our onPointerUp never ran)
    // would arm the drag on a simple hover and the button would follow the
    // cursor around with nothing pressed — impossible to click. Touch is
    // unaffected: a touch pointer always reports buttons === 1 while down.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      resetPress();
      return;
    }

    if (!pressOriginRef.current) return;
    const dx = event.clientX - pressOriginRef.current.x;
    const dy = event.clientY - pressOriginRef.current.y;
    if (Math.hypot(dx, dy) < DRAG_ARM_THRESHOLD_PX) return;
    dragArmedRef.current = true;
    wasDraggedRef.current = true;
    dragControls.start(event);
  };

  const resetPress = () => {
    pressOriginRef.current = null;
    dragArmedRef.current = false;
  };

  // Safety net for presses that end anywhere but on the button (drag released
  // over the map, pointer cancelled by the browser, window blurred). Without
  // it the press origin stays armed and the next mouse movement is read as a
  // drag.
  useEffect(() => {
    const clear = () => {
      pressOriginRef.current = null;
      dragArmedRef.current = false;
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // High contrast styling overrides
  const pageBg = isHighContrast ? "bg-black text-white" : "bg-bg-app text-text-main";
  const cardBg = isHighContrast
    ? "bg-zinc-950 border-2 border-white text-white"
    : "bg-white border border-gray-100/80 shadow-md text-text-main";
  const iconBoxBg = isHighContrast
    ? "bg-black text-yellow-400 border border-white"
    : "bg-brand-light text-brand";
  const buttonActiveBg = isHighContrast
    ? "bg-yellow-400 text-black border-2 border-white"
    : "bg-brand text-white";
  const buttonInactiveBg = isHighContrast
    ? "bg-zinc-900 text-white border border-zinc-700"
    : "bg-gray-150 text-text-secondary hover:bg-gray-200";

  const theme: PanelTheme = {
    isHighContrast,
    reduceMotion: reduceMotionActive,
    cardBg,
    iconBoxBg,
    activeBg: buttonActiveBg,
    inactiveBg: buttonInactiveBg,
  };

  return (
    <>
      {/* Drag constraints container spans the whole viewport so the button
          can be moved to and dropped at any position on screen. */}
      <div ref={dragBoundsRef} className="absolute inset-0 pointer-events-none z-[60]">
        {/* DESKTOP (xl+): a plain, FIXED button in the top-right corner.
            Rendered as a separate element on purpose — the mobile one below is
            a Framer `motion.button` whose drag offsets live in an inline
            `transform`, which no breakpoint class can cancel. So desktop got a
            leftover saved position and re-armed the drag on hover, making the
            button jump around. No drag, no motion values, no saved offset
            here: it simply cannot move. Mobile markup stays exactly as it was. */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={`pointer-events-auto absolute top-4 right-4 w-13 h-13 rounded-full shadow-2xl hidden xl:flex items-center justify-center cursor-pointer border ${
            reduceMotionActive ? "" : "transition-colors"
          } ${
            isHighContrast
              ? "bg-yellow-400 border-white text-black font-black hover:bg-yellow-300"
              : "bg-brand border-brand/10 text-white hover:bg-brand-dark"
          }`}
          aria-label="Abrir Tela de Acessibilidade"
          title="Abrir Central de Acessibilidade"
        >
          <FaUniversalAccess className="w-7 h-7" />
        </button>

        {/* MOBILE/TABLET (< xl): Floating Accessibility Circle Button —
            draggable, defaults to Left Side */}
        <motion.button
          drag
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={dragBoundsRef}
          dragMomentum={false}
          dragElastic={reduceMotionActive ? 0 : 0.08}
          onDragEnd={handleDragEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={resetPress}
          onPointerLeave={resetPress}
          onPointerCancel={resetPress}
          style={{ x: dragX, y: dragY, transition: reduceMotionActive ? "none" : undefined }}
          onClick={handleButtonClick}
          className={`pointer-events-auto absolute left-4 bottom-28 w-13 h-13 rounded-full shadow-2xl flex xl:hidden items-center justify-center ${
            reduceMotionActive ? "" : "transition-colors hover:scale-105"
          } cursor-pointer active:cursor-grabbing touch-none border ${
            isHighContrast
              ? "bg-yellow-400 border-white text-black font-black"
              : "bg-brand border-brand/10 text-white"
          }`}
          aria-label="Abrir Tela de Acessibilidade. Segure e arraste para reposicionar o botão."
          title="Clique para abrir. Segure e arraste para mover."
        >
          <FaUniversalAccess className="w-7 h-7" />
        </motion.button>
      </div>

      {/* Dedicated Accessibility Screen with Slide Transition (From the side) */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={reduceMotionActive ? { x: 0 } : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduceMotionActive ? { x: 0 } : { x: "100%" }}
            transition={reduceMotionActive ? { duration: 0 } : { type: "spring", damping: 30, stiffness: 300 }}
            className={`absolute inset-0 z-[70] flex flex-col overflow-hidden ${pageBg} xl:left-auto xl:right-0 xl:top-0 xl:bottom-0 xl:w-[380px] xl:border-l xl:border-gray-200 xl:shadow-2xl`}
          >
            {/* Header */}
            <div className={`px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-4 flex items-center gap-4 border-b flex-shrink-0 ${
              isHighContrast ? "border-zinc-800 bg-black" : "border-gray-100 bg-white/80 backdrop-blur-md"
            }`}>
              <button
                onClick={() => setIsOpen(false)}
                className={`p-2.5 rounded-full transition-all active:scale-95 cursor-pointer ${
                  isHighContrast
                    ? "bg-zinc-900 text-yellow-400 border border-zinc-700 hover:bg-zinc-800"
                    : "bg-gray-100 text-text-main hover:bg-gray-200"
                }`}
                aria-label="Voltar"
              >
                <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
              </button>
              <div>
                <h1 className="font-black text-lg leading-tight flex items-center gap-2">
                  <FaUniversalAccess className="w-5 h-5 text-brand" />
                  Central de Acessibilidade
                </h1>
              </div>
            </div>

            {/* Scrollable Content Body */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-6 flex flex-col gap-5 accessibility-menu-panel">

              {/* Alto Contraste */}
              <SettingCard
                theme={theme}
                icon={Contrast}
                title="Modo de Alto Contraste"
                description="Aplica paleta de alto contraste em preto e amarelo, otimizada para pessoas com baixa visão ou fotofobia."
              >
                <ToggleRow
                  theme={theme}
                  active={isHighContrast}
                  onToggle={() => setIsHighContrast(!isHighContrast)}
                  label="Alternar Alto Contraste"
                />
              </SettingCard>

              {/* Tamanho do Texto */}
              <SettingCard
                theme={theme}
                icon={Type}
                title="Tamanho do Texto"
                description="Redimensione proporcionalmente as fontes de menus, descrições e títulos para maior conforto visual."
              >
                <OptionGroup
                  theme={theme}
                  options={FONT_SCALE_OPTIONS}
                  value={safeScale}
                  onChange={setFontScale}
                  groupLabel="Tamanho do texto"
                />
              </SettingCard>

              {/* Saturação das Cores */}
              <SettingCard
                theme={theme}
                icon={Palette}
                title="Saturação das Cores"
                description="Intensifique, suavize ou remova totalmente as cores da interface, deixando tudo em escala de cinza."
              >
                <OptionGroup
                  theme={theme}
                  options={SATURATION_OPTIONS}
                  value={saturation}
                  onChange={setSaturation}
                  groupLabel="Saturação das cores"
                  columns={4}
                />
                {isHighContrast && (
                  <p className="text-[11px] font-bold text-text-secondary leading-relaxed">
                    Em pausa enquanto o Alto Contraste estiver ativo: os dois recursos controlam a mesma
                    paleta. Sua escolha fica guardada e volta a valer ao desligar o Alto Contraste.
                  </p>
                )}
              </SettingCard>

              {/* Espaçamento do Texto */}
              <SettingCard
                theme={theme}
                icon={MoveHorizontal}
                title="Espaçamento do Texto"
                description="Aumenta ou reduz o espaço entre letras e palavras. Os textos continuam quebrando dentro dos cards, sem vazar do layout."
              >
                <OptionGroup
                  theme={theme}
                  options={TEXT_SPACING_OPTIONS}
                  value={textSpacing}
                  onChange={setTextSpacing}
                  groupLabel="Espaçamento do texto"
                  columns={4}
                />
              </SettingCard>

              {/* Altura da Linha */}
              <SettingCard
                theme={theme}
                icon={StretchVertical}
                title="Altura da Linha"
                description="Aumenta o espaço vertical entre as linhas de parágrafos, listas e títulos, facilitando acompanhar a leitura."
              >
                <OptionGroup
                  theme={theme}
                  options={LINE_HEIGHT_OPTIONS}
                  value={lineHeight}
                  onChange={setLineHeight}
                  groupLabel="Altura da linha"
                />
              </SettingCard>

              {/* Ocultar Imagens */}
              <SettingCard
                theme={theme}
                icon={ImageOff}
                title="Ocultar Imagens"
                description="Esconde fotos e galerias para uma navegação focada no texto. O espaço das imagens é recolhido, sem áreas vazias — o mapa continua visível."
              >
                <ToggleRow
                  theme={theme}
                  active={hideImages}
                  onToggle={() => setHideImages(!hideImages)}
                  label="Alternar Ocultar Imagens"
                />
              </SettingCard>

              {/* Modo Dislexia */}
              <SettingCard
                theme={theme}
                icon={BookOpen}
                title="Leitura para Dislexia"
                description="Tipografia mais legível, sem itálico nem caixa alta, com mais espaço entre letras, palavras e linhas. Funciona independente dos outros ajustes."
              >
                <ToggleRow
                  theme={theme}
                  active={dyslexiaMode}
                  onToggle={() => setDyslexiaMode(!dyslexiaMode)}
                  label="Alternar Modo de Leitura para Dislexia"
                />
              </SettingCard>

              {/* Leitura em Voz Alta */}
              <SettingCard
                theme={theme}
                icon={Volume2}
                title="Leitura em Voz Alta"
                description="Ativa assistência sonora e audiodescrição em guias turísticos e detalhes de monumentos."
              >
                <ToggleRow
                  theme={theme}
                  active={voiceActive}
                  onToggle={() => setVoiceActive(!voiceActive)}
                  label="Alternar Leitura em Voz Alta"
                />
              </SettingCard>

              {/* Reduzir Movimento */}
              <SettingCard
                theme={theme}
                icon={ZapOff}
                title="Reduzir Movimento"
                description="Desativa todas as animações, transições e efeitos de movimento de toda a plataforma."
              >
                <ToggleRow
                  theme={theme}
                  active={reduceMotionActive}
                  onToggle={() => setReduceMotionActive(!reduceMotionActive)}
                  label="Alternar Reduzir Movimento"
                />
              </SettingCard>

              {/* Restaurar configurações */}
              <div className="flex flex-col gap-2 pb-2">
                <button
                  onClick={() => {
                    onResetSettings();
                    setJustReset(true);
                  }}
                  className={`flex items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold transition-colors cursor-pointer border ${
                    isHighContrast
                      ? "bg-zinc-900 border-white text-yellow-400 hover:bg-zinc-800"
                      : "bg-white border-gray-200 text-text-main hover:bg-gray-50"
                  }`}
                >
                  <RotateCcw className="w-4 h-4" />
                  Restaurar configurações
                </button>
                <p
                  role="status"
                  className={`text-[11px] font-bold text-center leading-relaxed ${
                    justReset ? (isHighContrast ? "text-yellow-400" : "text-brand") : "text-text-secondary"
                  }`}
                >
                  {justReset
                    ? "Configurações restauradas para o padrão."
                    : "Volta todos os ajustes desta tela ao padrão original do app."}
                </p>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
