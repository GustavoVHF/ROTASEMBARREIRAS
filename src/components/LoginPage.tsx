"use client";

import React, { useState } from "react";
import { Mail, ArrowLeft, Eye, EyeOff, User as UserIcon, ShieldAlert, X } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import PrivacyPolicySheet from "./PrivacyPolicySheet";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

type AuthScreen = "signin" | "signup" | "verify";

function validatePassword(pwd: string, isSignup: boolean): string | null {
  if (!isSignup) return pwd.length >= 6 ? null : "Senha deve ter no mínimo 6 caracteres.";
  if (pwd.length < 8) return "Senha deve ter no mínimo 8 caracteres.";
  if (!/[A-Z]/.test(pwd)) return "Senha deve conter pelo menos 1 letra maiúscula.";
  if (!/\d/.test(pwd)) return "Senha deve conter pelo menos 1 número.";
  return null;
}

interface LoginPageProps {
  onClose?: () => void;
  initialScreen?: AuthScreen;
}

export default function LoginPage({ onClose, initialScreen = "signin" }: LoginPageProps) {
  const { login, loginWithOAuth, signup, isAnonymous, preferences } = useAuth();
  const reduceMotion = preferences?.reduce_motion_enabled ?? false;

  const [oauthLoading, setOauthLoading] = useState<"google" | null>(null);
  const [oauthError, setOauthError] = useState("");
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const [screen, setScreen] = useState<AuthScreen>(initialScreen);
  const [direction, setDirection] = useState(1); // 1 = forward (slide left), -1 = backward (slide right)
  
  // Form states
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  // Auth processing states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);

  // Navigate between screens
  const navigateTo = (nextScreen: AuthScreen, forward: boolean = true) => {
    setDirection(forward ? 1 : -1);
    setError("");
    setSuccess("");
    setScreen(nextScreen);
  };

  // Social login (Google) — redirects to provider, Supabase brings the
  // user back via /auth/callback with an active session.
  const handleOAuthLogin = async (provider: "google") => {
    setOauthError("");
    try {
      setOauthLoading(provider);
      await loginWithOAuth(provider);
      // Browser navigates away here; loading state is left on until the
      // redirect happens (or the request errors below).
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : "Não foi possível continuar com este provedor.");
      setOauthLoading(null);
    }
  };

  // Submit Sign In (Screen 2)
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;

    setError("");
    setSuccess("");

    if (!EMAIL_REGEX.test(email)) {
      setError("Email inválido.");
      return;
    }

    const pwdError = validatePassword(password, false);
    if (pwdError) {
      setError(pwdError);
      return;
    }

    try {
      setLoading(true);
      await login(email, password);
      if (onClose) onClose();
    } catch (err) {
      const nextAttempts = attemptCount + 1;
      setAttemptCount(nextAttempts);

      if (nextAttempts >= MAX_ATTEMPTS) {
        setIsLocked(true);
        setError("Muitas tentativas com erro. Bloqueado por 60 segundos.");
        setTimeout(() => {
          setIsLocked(false);
          setAttemptCount(0);
          setError("");
        }, LOCKOUT_MS);
      } else if (err instanceof Error && err.message.toLowerCase().includes("rate limit")) {
        setError(`Muitas tentativas. Aguarde 60s antes de tentar novamente.`);
      } else {
        setError(err instanceof Error ? err.message : "Erro ao autenticar.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Submit Sign Up (Screen 3)
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (fullName.trim().length < 2) {
      setError("Informe seu nome completo.");
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      setError("Email inválido.");
      return;
    }

    const pwdError = validatePassword(password, true);
    if (pwdError) {
      setError(pwdError);
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não conferem.");
      return;
    }

    try {
      setLoading(true);
      const { needsEmailConfirmation } = await signup(email, password, fullName.trim());
      
      if (needsEmailConfirmation) {
        navigateTo("verify", true);
      } else {
        setSuccess("Conta criada e vinculada com sucesso!");
        if (onClose) {
          onClose();
        } else {
          navigateTo("signin", true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cadastrar.");
    } finally {
      setLoading(false);
    }
  };

  // Confirm Simulated Email Validation (Screen 4)
  const handleVerifyConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    setSuccess("E-mail confirmado com sucesso!");
    setLoading(true);
    
    // Simulate redirecting to sign in or app load
    setTimeout(async () => {
      try {
        await login(email, password);
      } catch {
        setError("Por favor, clique no link de confirmação enviado para seu e-mail.");
        navigateTo("signin", false);
        setLoading(false);
      }
    }, 1500);
  };

  // Motion variants for smooth fluid slide transition (no spring bounce or stutter)
  const slideVariants = {
    enter: (dir: number) => ({
      x: reduceMotion ? 0 : dir > 0 ? "35%" : "-35%",
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: reduceMotion ? 0 : dir > 0 ? "-35%" : "35%",
      opacity: 0,
    }),
  };

  const smoothTransition = {
    duration: reduceMotion ? 0 : 0.28,
    ease: [0.25, 1, 0.5, 1] as const,
  };

  return (
    <>
      <div className="w-full h-full min-h-full bg-bg-app flex flex-col justify-between font-sans antialiased relative overflow-hidden">
      {/* Core Content Area */}
      <div className="flex-1 relative overflow-hidden flex flex-col justify-between">
        <div className="flex-1 overflow-y-auto no-scrollbar relative w-full">
          <AnimatePresence initial={false} custom={direction} mode="wait">

              {/* SCREEN 2: SIGN IN - ALL TRANSLATED TO PORTUGUESE */}
              {screen === "signin" && (
                <motion.div
                  key="signin"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={smoothTransition}
                  className="absolute inset-0 px-6 pt-[calc(env(safe-area-inset-top)+56px)] lg:pt-14 pb-16 lg:pb-8 flex flex-col justify-between overflow-y-auto no-scrollbar"
                >
                  <div className="flex-1 flex flex-col">
                    {/* Header */}
                    <h3 className="text-center font-black text-xl lg:text-2xl text-text-main mt-4 lg:mt-6 mb-4">
                      Bem-vindo de volta
                    </h3>

                    {/* Social Login - Google & Facebook */}
                    <div className="flex flex-col gap-2.5 max-w-sm mx-auto w-full">
                      <button
                        type="button"
                        onClick={() => handleOAuthLogin("google")}
                        disabled={oauthLoading !== null}
                        className="w-full flex items-center justify-center gap-3 bg-white border border-gray-200 text-text-main font-bold text-sm py-3.5 px-6 rounded-full hover:bg-gray-50 active:scale-95 transition-all shadow-sm h-13 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {oauthLoading === "google" ? (
                          <div className="w-5 h-5 border-2 border-text-secondary border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <FcGoogle className="w-5 h-5" />
                            Continuar com Google
                          </>
                        )}
                      </button>

                      {oauthError && (
                        <p role="alert" className="text-xs font-bold text-red-600 px-3 flex items-start gap-1.5 leading-relaxed">
                          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                          <span>{oauthError}</span>
                        </p>
                      )}
                    </div>

                    {/* Divider between social buttons and email login */}
                    <div className="flex items-center gap-3 max-w-sm mx-auto w-full my-5">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">ou</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Form - Translated */}
                    <form onSubmit={handleSignIn} className="flex flex-col gap-3.5 max-w-sm mx-auto w-full">
                      <div>
                        <label htmlFor="signin-email" className="block text-[11px] font-black uppercase text-text-secondary tracking-wider mb-1 pl-1">
                          Endereço de E-mail
                        </label>
                        <input
                          id="signin-email"
                          type="email"
                          required
                          placeholder="exemplo@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full bg-white border border-gray-200 rounded-full px-5 py-3 text-base text-text-main font-semibold focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/50 h-13"
                        />
                      </div>

                      <div>
                        <label htmlFor="signin-pwd" className="block text-[11px] font-black uppercase text-text-secondary tracking-wider mb-1 pl-1">
                          Senha
                        </label>
                        <div className="relative">
                          <input
                            id="signin-pwd"
                            type={showPassword ? "text" : "password"}
                            required
                            placeholder="••••••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-full pl-5 pr-13 py-3 text-base text-text-main font-semibold focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/50 h-13"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary p-2 rounded-full hover:bg-gray-50 transition-colors"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {error && (
                        <p role="alert" className="text-xs font-bold text-red-600 px-3 flex items-start gap-1.5 leading-relaxed mt-1">
                          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                          <span>{error}</span>
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={loading || isLocked}
                        className="w-full bg-brand hover:bg-brand-dark text-white font-extrabold text-sm py-4 px-6 rounded-full uppercase tracking-widest active:scale-95 transition-all shadow-md shadow-brand/10 mt-2 h-13.5 flex items-center justify-center cursor-pointer"
                      >
                        {loading ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          "ENTRAR"
                        )}
                      </button>
                    </form>
                  </div>

                  {/* Create One - Positioned closer to bottom */}
                  <div className="mt-auto pt-6 text-center max-w-sm mx-auto w-full flex flex-col gap-2.5 flex-shrink-0">
                    <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Não tem uma conta?</span>
                    <button
                      onClick={() => navigateTo("signup", true)}
                      className="w-full bg-white border border-gray-300 text-text-main font-extrabold text-xs py-4 px-6 rounded-full uppercase tracking-widest hover:bg-gray-50 active:scale-95 transition-all shadow-sm h-13.5 cursor-pointer"
                    >
                      CRIAR UMA CONTA
                    </button>
                    <button
                      onClick={() => setPrivacyOpen(true)}
                      className="w-full text-center text-xs font-bold text-text-secondary hover:text-brand underline py-2"
                    >
                      Política de Privacidade
                    </button>
                  </div>
                </motion.div>
              )}

              {/* SCREEN 3: SIGN UP - ALL TRANSLATED */}
              {screen === "signup" && (
                <motion.div
                  key="signup"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={smoothTransition}
                  className="absolute inset-0 px-6 pt-[calc(env(safe-area-inset-top)+44px)] lg:pt-12 pb-16 lg:pb-8 flex flex-col justify-between overflow-y-auto no-scrollbar"
                >
                  <div className="flex-1 flex flex-col">
                    {/* Back Button */}
                    <button
                      onClick={() => navigateTo("signin", false)}
                      className="mb-2 p-2 bg-gray-50 hover:bg-gray-100 text-text-secondary rounded-full active:scale-90 transition-all self-start cursor-pointer"
                      title="Voltar ao Login"
                    >
                      <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
                    </button>

                    {/* Header */}
                    <h3 className="text-center font-black text-xl lg:text-2xl text-text-main">
                      Nova Conta
                    </h3>
                    <p className="text-center text-xs font-bold text-text-secondary mt-0.5">
                      Faça parte da nossa rota acessível
                    </p>

                    {/* Form - Translated */}
                    <form onSubmit={handleSignUp} className="flex flex-col gap-3 mt-4 max-w-sm mx-auto w-full">
                      <div>
                        <label htmlFor="signup-name" className="block text-[10px] font-black uppercase text-text-secondary tracking-wider mb-1 pl-1">
                          Nome Completo
                        </label>
                        <div className="relative flex items-center">
                          <UserIcon className="w-4 h-4 text-text-secondary absolute left-4" />
                          <input
                            id="signup-name"
                            type="text"
                            required
                            placeholder="Seu nome"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-full pl-11 pr-5 py-2.5 text-sm text-text-main font-semibold focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/50 h-12"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="signup-email" className="block text-[10px] font-black uppercase text-text-secondary tracking-wider mb-1 pl-1">
                          Endereço de E-mail
                        </label>
                        <div className="relative flex items-center">
                          <Mail className="w-4 h-4 text-text-secondary absolute left-4" />
                          <input
                            id="signup-email"
                            type="email"
                            required
                            placeholder="exemplo@email.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-full pl-11 pr-5 py-2.5 text-sm text-text-main font-semibold focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/50 h-12"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="signup-pwd" className="block text-[10px] font-black uppercase text-text-secondary tracking-wider mb-1 pl-1">
                          Senha
                        </label>
                        <div className="relative">
                          <input
                            id="signup-pwd"
                            type={showPassword ? "text" : "password"}
                            required
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-full pl-5 pr-11 py-2.5 text-sm text-text-main font-semibold focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/50 h-12"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary p-1.5 rounded-full hover:bg-gray-50 transition-colors"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="signup-conf-pwd" className="block text-[10px] font-black uppercase text-text-secondary tracking-wider mb-1 pl-1">
                          Confirmar Senha
                        </label>
                        <input
                          id="signup-conf-pwd"
                          type={showPassword ? "text" : "password"}
                          required
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full bg-white border border-gray-200 rounded-full px-5 py-2.5 text-sm text-text-main font-semibold focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/50 h-12"
                        />
                      </div>

                      {error && (
                        <p role="alert" className="text-xs font-bold text-red-600 px-3 flex items-start gap-1.5 leading-relaxed">
                          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                          <span>{error}</span>
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-brand hover:bg-brand-dark text-white font-extrabold text-xs py-3.5 px-6 rounded-full uppercase tracking-widest active:scale-95 transition-all shadow-md shadow-brand/10 mt-2 h-12 flex items-center justify-center cursor-pointer"
                      >
                        {loading ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          "CADASTRAR"
                        )}
                      </button>
                    </form>
                  </div>

                  {/* Footer Back to Sign In */}
                  <div className="mt-auto pt-4 text-center max-w-sm mx-auto w-full flex flex-col gap-2 flex-shrink-0">
                    <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">Já tem uma conta?</span>
                    <button
                      onClick={() => navigateTo("signin", false)}
                      className="w-full bg-white border border-gray-300 text-text-main font-extrabold text-xs py-3.5 px-6 rounded-full uppercase tracking-widest hover:bg-gray-50 active:scale-95 transition-all shadow-sm h-12 cursor-pointer"
                    >
                      ENTRAR
                    </button>
                  </div>
                </motion.div>
              )}

              {/* SCREEN 4: EMAIL VERIFICATION (NO 6-DIGIT CODE, LINK ONLY) */}
              {screen === "verify" && (
                <motion.div
                  key="verify"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={smoothTransition}
                  className="absolute inset-0 px-6 pt-10 pb-8 flex flex-col justify-between overflow-y-auto no-scrollbar"
                >
                  <div className="flex flex-col items-center justify-center flex-1">
                    {/* Back Button */}
                    <button
                      onClick={() => navigateTo("signup", false)}
                      className="mb-8 p-2.5 bg-gray-50 hover:bg-gray-100 text-text-secondary rounded-full active:scale-90 transition-all self-start"
                      title="Voltar"
                    >
                      <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
                    </button>

                    {/* Message Container */}
                    <div className="flex flex-col items-center text-center">
                      <div className="w-20 h-20 rounded-full bg-brand flex items-center justify-center shadow-lg shadow-brand/10 mb-8">
                        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
                          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                          <path d="m16 19 2 2 4-4" />
                        </svg>
                      </div>
                      
                      <h3 className="text-center font-black text-2xl text-text-main">
                        Confirme seu e-mail
                      </h3>
                      <p className="text-center text-sm font-semibold text-text-secondary mt-4 max-w-[280px] leading-relaxed">
                        Enviamos uma mensagem de ativação para:
                        <span className="block font-black text-text-main mt-2 text-base">{email}</span>
                      </p>
                      <p className="text-center text-xs font-bold text-text-secondary mt-6 max-w-[280px] leading-relaxed bg-brand-light/40 border border-brand-light p-4.5 rounded-2xl">
                        Por favor, abra sua caixa de entrada e clique no link recebido para confirmar seu cadastro.
                      </p>
                    </div>

                    {error && (
                      <p role="alert" className="text-xs font-bold text-red-600 px-3 flex items-start gap-1.5 leading-relaxed mt-4">
                        <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                        <span>{error}</span>
                      </p>
                    )}
                    {success && (
                      <p role="status" className="text-xs font-bold text-brand px-3 leading-relaxed mt-4">
                        {success}
                      </p>
                    )}

                    {/* Main action button to proceed after link verification */}
                    <button
                      onClick={handleVerifyConfirm}
                      disabled={loading}
                      className="w-full bg-brand hover:bg-brand-dark text-white font-extrabold text-sm py-4.5 px-6 rounded-full uppercase tracking-widest active:scale-95 transition-all shadow-md shadow-brand/10 mt-8 h-14 flex items-center justify-center"
                    >
                      {loading ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        "JÁ CONFIRMEI E QUERO ENTRAR"
                      )}
                    </button>
                  </div>

                  {/* Re-send links */}
                  <div className="mt-8 text-center max-w-sm mx-auto w-full flex flex-col gap-2.5 flex-shrink-0">
                    <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Não recebeu a mensagem?</span>
                    <button
                      type="button"
                      onClick={() => alert("Simulação: E-mail de confirmação reenviado.")}
                      className="text-[11px] font-black text-brand hover:text-brand-dark uppercase tracking-widest"
                    >
                      Reenviar E-mail
                    </button>
                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </div>
      </div>

      <PrivacyPolicySheet isOpen={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </>
  );
}
