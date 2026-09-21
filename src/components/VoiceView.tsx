"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Sparkles, AlertTriangle, Square } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { fetchVoiceToken, VoiceTokenError } from "@/services/voiceTokenService";
import { executeVoiceAction, VoiceActionContext } from "@/services/voiceActionExecutor";
import { GeminiLiveClient, LiveFunctionCall, LiveFunctionResponse } from "@/lib/voice/geminiLiveClient";
import { MicCapture } from "@/lib/voice/micCapture";
import { AudioPlayback } from "@/lib/voice/audioPlayback";
import { connectingSound } from "@/lib/voice/connectingSound";
import { track } from "@/lib/analytics";
import type { TouristPoint } from "@/types/point";

type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

interface VoiceViewProps {
  userId: string;
  points: TouristPoint[];
  searchedPoints?: TouristPoint[];
  userLocation: [number, number] | null;
  goToPoint: (point: TouristPoint) => void;
  goToTrailsForCity: (city: string) => void;
  goToTrails: () => void;
  goToMap: () => void;
  goToProfile: () => void;
  openScanner: () => void;
  setHighContrast: (v: boolean) => void;
  setVLibras: (v: boolean) => void;
  setVoiceReading: (v: boolean) => void;
  setReduceMotion: (v: boolean) => void;
  increaseFontScale: () => void;
  decreaseFontScale: () => void;
}

export default function VoiceView({
  userId,
  points,
  searchedPoints = [],
  userLocation,
  goToPoint,
  goToTrailsForCity,
  goToTrails,
  goToMap,
  goToProfile,
  openScanner,
  setHighContrast,
  setVLibras,
  setVoiceReading,
  setReduceMotion,
  increaseFontScale,
  decreaseFontScale,
}: VoiceViewProps) {
  const { user, profile, preferences } = useAuth();
  const isHighContrast = preferences?.high_contrast_enabled ?? false;
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;
  const userName =
    (profile as unknown as { nome?: string; full_name?: string })?.nome ||
    (profile as unknown as { nome?: string; full_name?: string })?.full_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Visitante";
  const userEmail = user?.email || "";

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [lastUserTranscript, setLastUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript] = useState("");

  const mountedRef = useRef(true);
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playbackRef = useRef<AudioPlayback | null>(null);
  const pendingNavRef = useRef<(() => void) | null>(null);
  const turnCompleteRef = useRef(false);
  const speakingRef = useRef(false);
  const sessionIdRef = useRef(0);
  const endConversationRef = useRef(false);
  /** Início da conversa, só para medir a duração em segundos. */
  const sessionStartedAtRef = useRef<number | null>(null);

  // Always-fresh context for tool-call execution
  const ctxRef = useRef<VoiceActionContext>({
    userId,
    userName,
    userEmail,
    points,
    searchedPoints,
    userLocation,
    preferences: (preferences as unknown as Record<string, unknown>) || {},
    goToPoint,
    goToTrailsForCity,
    goToTrails,
    goToMap,
    goToProfile,
    openScanner,
    setHighContrast,
    setVLibras,
    setVoiceReading,
    setReduceMotion,
    increaseFontScale,
    decreaseFontScale,
  });
  useEffect(() => {
    ctxRef.current = {
      userId,
      userName,
      userEmail,
      points,
      searchedPoints,
      userLocation,
      preferences: (preferences as unknown as Record<string, unknown>) || {},
      goToPoint,
      goToTrailsForCity,
      goToTrails,
      goToMap,
      goToProfile,
      openScanner,
      setHighContrast,
      setVLibras,
      setVoiceReading,
      setReduceMotion,
      increaseFontScale,
      decreaseFontScale,
    };
  }, [
    userId,
    userName,
    userEmail,
    points,
    searchedPoints,
    userLocation,
    preferences,
    goToPoint,
    goToTrailsForCity,
    goToTrails,
    goToMap,
    goToProfile,
    openScanner,
    setHighContrast,
    setVLibras,
    setVoiceReading,
    setReduceMotion,
    increaseFontScale,
    decreaseFontScale,
  ]);

  const cleanupSession = useCallback(() => {
    // Medição: duração da conversa. Vai só o número de segundos — nenhum
    // áudio, nenhuma transcrição, nenhum trecho do que foi dito.
    if (sessionStartedAtRef.current !== null) {
      const duracao = Math.round((Date.now() - sessionStartedAtRef.current) / 1000);
      sessionStartedAtRef.current = null;
      track("assistente_voz_encerrado", { duracao_segundos: duracao });
    }
    sessionIdRef.current += 1; // invalidate any in-flight async work from this session
    connectingSound.stop();
    try {
      clientRef.current?.disconnect();
    } catch (err) {
      console.error("voice: client disconnect failed", err);
    }
    clientRef.current = null;
    try {
      micRef.current?.stop();
    } catch (err) {
      console.error("voice: mic stop failed", err);
    }
    micRef.current = null;
    try {
      playbackRef.current?.destroy();
    } catch (err) {
      console.error("voice: playback destroy failed", err);
    }
    playbackRef.current = null;
    pendingNavRef.current = null;
    turnCompleteRef.current = false;
    speakingRef.current = false;
    endConversationRef.current = false;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Control connecting/thinking audio chime
  useEffect(() => {
    if (voiceState === "connecting" || voiceState === "thinking") {
      connectingSound.start();
    } else {
      connectingSound.stop();
    }
    return () => {
      connectingSound.stop();
    };
  }, [voiceState]);

  /** Runs once the model has genuinely finished speaking this turn (both
   * turnComplete arrived AND the audio queue actually drained). If a tool
   * call queued a screen change, apply it now — then tear down the live
   * session, since navigating away unmounts this view anyway. */
  const maybeFinishTurn = useCallback(() => {
    if (!turnCompleteRef.current || speakingRef.current) return;
    turnCompleteRef.current = false;

    const nav = pendingNavRef.current;
    pendingNavRef.current = null;
    const shouldEnd = endConversationRef.current;

    if (nav) {
      nav();
      cleanupSession();
      if (mountedRef.current) {
        setVoiceState("idle");
        setStatusMessage("Toque para conversar.");
      }
      return;
    }

    if (shouldEnd) {
      // Model called end_conversation this turn (user said goodbye) and
      // has now finished speaking its goodbye line — hang up.
      cleanupSession();
      if (mountedRef.current) {
        setVoiceState("idle");
        setStatusMessage("Conversa encerrada. Toque para começar de novo.");
      }
      return;
    }

    if (mountedRef.current) {
      setVoiceState("listening");
      setStatusMessage("Ouvindo...");
    }
  }, [cleanupSession]);

  const handleToolCall = useCallback(
    async (calls: LiveFunctionCall[]) => {
      const responses: LiveFunctionResponse[] = [];
      for (const call of calls) {
        const executed = await executeVoiceAction(call, ctxRef.current);
        responses.push({ id: call.id, name: call.name, response: executed.response });
        if (executed.navigatesAway && executed.sideEffect) {
          pendingNavRef.current = executed.sideEffect;
        }
        if (executed.endsConversation) {
          endConversationRef.current = true;
        }
      }
      clientRef.current?.sendToolResponse(responses);
    },
    []
  );

  const startSession = useCallback(async () => {
    if (!mountedRef.current) return;
    const mySessionId = ++sessionIdRef.current;
    const isStale = () => !mountedRef.current || sessionIdRef.current !== mySessionId;

    setVoiceState("connecting");
    setStatusMessage("Conectando...");
    setLastUserTranscript("");
    setAiTranscript("");

    // Medição: início da conversa por voz. Evento sem propriedades; o par
    // "assistente_voz_encerrado" leva só a duração.
    sessionStartedAtRef.current = Date.now();
    track("assistente_voz_iniciado");

    try {
      const playback = new AudioPlayback();
      playbackRef.current = playback;

      // Parallelize token issuance and AudioPlayback init for minimum latency
      const [tokenResult] = await Promise.all([
        fetchVoiceToken(userName),
        playback.init(),
      ]);
      if (isStale()) {
        playback.destroy();
        return;
      }
      playback.onDrain = () => {
        if (isStale()) return;
        speakingRef.current = false;
        maybeFinishTurn();
      };

      const mic = new MicCapture();
      micRef.current = mic;

      const client = new GeminiLiveClient(tokenResult.model, {
        onOpen: async () => {
          if (isStale()) return;
          try {
            await mic.start((base64Pcm) => {
              if (isStale()) return;
              // Suppress mic streaming while AI is speaking to prevent phone speaker feedback / double turn generation
              if (speakingRef.current) return;
              clientRef.current?.sendAudioChunk(base64Pcm);
            });
          } catch {
            if (!isStale()) {
              setVoiceState("error");
              setStatusMessage("Não foi possível acessar o microfone.");
            }
            return;
          }
          if (isStale()) {
            // Stop tapped while getUserMedia was pending — don't leave the
            // mic stream open on a session that's already been torn down.
            mic.stop();
            return;
          }
          setVoiceState("listening");
          setStatusMessage("Ouvindo...");
        },
        onClose: (event) => {
          if (isStale()) return;
          cleanupSession();
          // Normal user-ended close (1000/1005) -> idle. Anything else
          // (server rejected setup, token bad, policy violation) -> show
          // the code/reason so the failure isn't silent.
          if (event.code === 1000 || event.code === 1005) {
            setVoiceState("idle");
            setStatusMessage("Conversa encerrada. Toque para começar de novo.");
          } else {
            setVoiceState("error");
            setStatusMessage(
              `Conexão encerrada [${event.code}]${event.reason ? ` ${event.reason}` : ""}.`
            );
          }
        },
        onError: (message) => {
          if (isStale()) return;
          cleanupSession();
          setVoiceState("error");
          setStatusMessage(message);
        },
        onAudioChunk: (base64Pcm) => {
          if (isStale()) return;
          speakingRef.current = true;
          setVoiceState("speaking");
          playbackRef.current?.play(base64Pcm);
        },
        onInputTranscript: (text) => {
          if (!isStale()) {
            setLastUserTranscript(text);
            setAiTranscript("");
            if (!speakingRef.current) {
              setVoiceState("listening");
              setStatusMessage("Ouvindo...");
            }
            if (isFarewell(text)) {
              endConversationRef.current = true;
            }
          }
        },
        onOutputTranscript: (text) => {
          if (!isStale()) {
            if (!speakingRef.current && voiceState !== "speaking") {
              setVoiceState("thinking");
              setStatusMessage("Pensando...");
            }
            setAiTranscript((prev) => prev + text);
            if (isFarewell(text)) {
              endConversationRef.current = true;
            }
          }
        },
        onInterrupted: () => {
          if (isStale()) return;
          // Barge-in: user started talking while the model was still
          // speaking. Stop playback instantly and drop any navigation
          // that was queued for the turn being cut off.
          playbackRef.current?.interrupt();
          speakingRef.current = false;
          turnCompleteRef.current = false;
          pendingNavRef.current = null;
          setAiTranscript("");
          setVoiceState("listening");
          setStatusMessage("Ouvindo...");
        },
        onTurnComplete: () => {
          if (isStale()) return;
          turnCompleteRef.current = true;
          maybeFinishTurn();
        },
        onToolCall: (calls) => {
          if (isStale()) return;
          handleToolCall(calls);
        },
        // goAway: server signaling imminent disconnect (token/session
        // window ending). No action needed here — the WebSocket's own
        // onclose fires shortly after and drives the UI back to idle.
      });

      if (isStale()) {
        client.disconnect();
        return;
      }
      clientRef.current = client;
      client.connect(tokenResult.token);
    } catch (err) {
      if (isStale()) return;
      cleanupSession();
      setVoiceState("error");
      if (err instanceof VoiceTokenError) {
        setStatusMessage(
          err.status === 429
            ? "Limite de sessões de voz atingido. Aguarde um minuto e tente novamente."
            : err.message
        );
      } else {
        setStatusMessage(err instanceof Error ? err.message : "Erro ao iniciar sessão de voz.");
      }
    }
  }, [cleanupSession, maybeFinishTurn, handleToolCall, userName]);

  const handleMainButtonTap = useCallback(() => {
    if (voiceState === "idle" || voiceState === "error") {
      startSession();
      return;
    }
    // Any active state (connecting/listening/speaking) — full stop.
    // This is the single control the user taps to end the conversation.
    // UI flips to idle FIRST, synchronously, before any teardown work —
    // the button must always visibly respond on this exact click, even in
    // a worst case where some resource's stop()/disconnect() throws.
    // cleanupSession() also isolates each teardown step in its own
    // try/catch as defense in depth, but this ordering is what actually
    // guarantees the tap is never silently swallowed.
    setVoiceState("idle");
    setStatusMessage("Conversa encerrada. Toque para começar de novo.");
    cleanupSession();
  }, [voiceState, startSession, cleanupSession]);

  const pageBg = isHighContrast ? "bg-black text-white" : "bg-bg-app text-text-main";

  const getStatusText = () => {
    switch (voiceState) {
      case "connecting":
        return "Conectando...";
      case "listening":
        return "Ouvindo...";
      case "thinking":
        return "Pensando...";
      case "speaking":
        return "Respondendo...";
      case "error":
        return "Ops!";
      default:
        return "Toque para Conversar";
    }
  };

function isFarewell(text: string): boolean {
  if (!text) return false;
  const norm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(tchau|tchauzinho|ate logo|ate mais|te mais|falou|valeu tchau|obrigado tchau|obrigada tchau|encerrar|pode encerrar|desligar|e so isso|fechar)\b/i.test(norm);
}

function cleanAiTranscript(text: string): string {
  if (!text) return "";
  // Remove markdown bold blocks like **Identifying the Query's Focus**
  let cleaned = text.replace(/\*\*[^*]+\*\*/g, "");
  // Remove backtick code blocks like `list_points_in_city`
  cleaned = cleaned.replace(/`[^`]+`/g, "");
  // Remove internal reasoning patterns if any
  cleaned = cleaned.replace(/(?:I've determined|My plan is to|The core function is|Identifying the Query)[^.\n]*[.\n]?/gi, "");
  // Remove leftover markdown symbols
  cleaned = cleaned.replace(/[*_#]/g, "");
  return cleaned.trim();
}

  const getSubTitleText = () => {
    switch (voiceState) {
      case "connecting":
        return "Conectando com o assistente de voz...";
      case "listening":
        return "Pode falar! Fale sobre pontos turísticos, cidades ou peça rotas acessíveis...";
      case "thinking":
        return "Processando sua pergunta...";
      case "speaking":
        return cleanAiTranscript(aiTranscript) || "Respondendo sua pergunta...";
      case "error":
        return statusMessage || "Ocorreu um erro na conexão.";
      default:
        return statusMessage || "Toque no botão central para começar a conversar por voz.";
    }
  };

  return (
    <div className={`w-full min-h-full overflow-x-hidden pb-28 pt-[calc(env(safe-area-inset-top)+20px)] px-6 max-w-md md:max-w-2xl mx-auto flex flex-col justify-between gap-6 ${pageBg} xl:max-w-2xl xl:mx-auto xl:my-auto xl:p-8 xl:bg-white xl:rounded-3xl xl:shadow-xl xl:border xl:border-gray-100 xl:pb-8 xl:pt-8`}>
      <div className="text-left flex flex-col pt-4">
        <h1 className="font-black text-2xl tracking-tight">Assistente de Voz</h1>
        <p className="text-xs font-semibold text-text-secondary mt-1 max-w-[300px] leading-relaxed">
          Converse naturalmente — pergunte sobre pontos turísticos, rotas, ative recursos de acessibilidade ou bata um papo.
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center my-4 gap-6">
        <div className="relative w-64 h-64 flex items-center justify-center">
          {!reduceMotion && voiceState !== "idle" && voiceState !== "error" && (
            <>
              <div
                className={`absolute inset-0 rounded-full border border-brand/20 transition-all duration-1000 pointer-events-none ${
                  voiceState === "listening"
                    ? "scale-105 bg-brand-light/40 animate-pulse"
                    : voiceState === "connecting"
                    ? "scale-95 bg-brand-light/60 border-brand/30"
                    : "scale-110 bg-brand-light/80 border-brand/40 animate-ping duration-1500"
                }`}
              />
              <div
                className={`absolute w-52 h-52 rounded-full border border-brand/10 transition-all duration-700 pointer-events-none ${
                  voiceState === "speaking" ? "scale-105 border-brand/30" : "scale-100"
                }`}
              />
            </>
          )}

          <button
            onClick={handleMainButtonTap}
            className={`relative z-10 w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 border-4 cursor-pointer ${
              voiceState === "error"
                ? "bg-red-600 border-white text-white"
                : isHighContrast
                ? "bg-yellow-400 border-white text-black"
                : "bg-brand border-white text-white"
            }`}
            aria-label={voiceState === "idle" || voiceState === "error" ? "Iniciar assistente de voz" : "Parar assistente de voz"}
          >
            {voiceState === "error" ? (
              <AlertTriangle className="w-12 h-12" />
            ) : voiceState === "connecting" || voiceState === "listening" || voiceState === "speaking" ? (
              <Square className="w-10 h-10 fill-current" />
            ) : (
              <Sparkles className="w-12 h-12 stroke-[2.2]" />
            )}
          </button>
        </div>

        <div className="text-center px-4 max-w-[300px]">
          <h2 className="text-xl font-black tracking-wide">{getStatusText()}</h2>
          <p className="text-xs text-text-secondary font-medium mt-1.5 leading-relaxed">{getSubTitleText()}</p>
          {lastUserTranscript && voiceState !== "idle" && (
            <p className="text-[11px] text-text-secondary/70 font-semibold mt-3 italic">
              &ldquo;{lastUserTranscript}&rdquo;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
