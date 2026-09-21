"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isAuthSessionError, recoverSupabaseSession } from "@/lib/supabase/sessionRecovery";
import { clearPointsCache } from "@/services/pointsService";
import type { AccessibilityPreferencesRow, Profile } from "@/types/database";

/** Every preference the Central de Acessibilidade can write. The visual/
 * reading ones (color_saturation .. dyslexia_mode_enabled) require
 * supabase/migrations_acessibilidade_central.sql. */
type EditablePreferences = Partial<
  Pick<
    AccessibilityPreferencesRow,
    | "audio_enabled"
    | "libras_enabled"
    | "high_contrast_enabled"
    | "font_scale"
    | "reduce_motion_enabled"
    | "color_saturation"
    | "text_spacing"
    | "line_height"
    | "hide_images_enabled"
    | "dyslexia_mode_enabled"
  >
>;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  preferences: AccessibilityPreferencesRow | null;
  loading: boolean;
  isAnonymous: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: "google") => Promise<void>;
  signup: (email: string, password: string, fullName: string) => Promise<{ needsEmailConfirmation: boolean }>;
  logout: () => Promise<void>;
  updatePreferences: (prefs: EditablePreferences) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Generic message on purpose — never reveal whether email exists (enumeration defense).
const GENERIC_AUTH_ERROR = "Email ou senha incorretos.";

function mapAuthError(message: string): string {
  if (message.includes("Invalid login credentials")) return GENERIC_AUTH_ERROR;
  if (message.includes("User already registered") || message.includes("email already in use") || message.includes("already registered")) return "Este email já possui cadastro. Faça login para continuar.";
  if (message.includes("Password should be at least")) return "Senha muito curta (mínimo 8 caracteres).";
  if (message.includes("rate limit") || message.includes("Too many")) return "Muitas tentativas. Aguarde um momento e tente novamente.";
  if (message.includes("Email not confirmed")) return "Confirme seu email antes de entrar.";
  return "Não foi possível autenticar. Tente novamente.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<AccessibilityPreferencesRow | null>(null);
  const [loading, setLoading] = useState(true);

  const isAnonymous = user ? (user.is_anonymous ?? false) : false;

  const loadUserData = useCallback(async (currentUser: User) => {
    // Função interna (declaração hoisted) para poder repetir a leitura uma vez
    // depois de consertar a sessão, sem o useCallback se referenciar.
    async function load(targetUser: User, isRetry: boolean): Promise<void> {
      const [
        { data: profileData, error: profileError },
        { data: prefsData, error: prefsError },
      ] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", targetUser.id).maybeSingle(),
        supabase.from("accessibility_preferences").select("*").eq("user_id", targetUser.id).maybeSingle(),
      ]);

      // Cookie de sessão inválido (refresh token já usado, token expirado com
      // o navegador suspenso): consertar aqui evita o usuário perder as
      // preferências de acessibilidade e ter que limpar os cookies na mão.
      // Uma repetição só — falha real continua falha.
      if (!isRetry && (isAuthSessionError(profileError) || isAuthSessionError(prefsError))) {
        const recovered = await recoverSupabaseSession(supabase);
        if (recovered) {
          const { data: { session: renewed } } = await supabase.auth.getSession();
          if (renewed?.user) {
            setSession(renewed);
            setUser(renewed.user);
          }
          await load(renewed?.user ?? targetUser, true);
          return;
        }
      }

      if (profileData) setProfile(profileData as Profile);
      else setProfile(null);

      if (prefsData) {
        setPreferences(prefsData as AccessibilityPreferencesRow);
      } else {
        // Row missing (new anonymous or permanent user) — create defaults
        const { data: created } = await supabase
          .from("accessibility_preferences")
          .upsert({ user_id: targetUser.id }, { onConflict: "user_id" })
          .select()
          .maybeSingle();
        if (created) setPreferences(created as AccessibilityPreferencesRow);
      }
    }

    await load(currentUser, false);
  }, [supabase]);

  // Ensure an active session exists on mount (create an anonymous session if none exists)
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      try {
        const { data: { session: s } } = await supabase.auth.getSession();
        let activeSession = s;

        if (!activeSession) {
          try {
            const { data, error } = await supabase.auth.signInAnonymously();
            if (!error && data?.session) {
              activeSession = data.session;
            }
          } catch (err) {
            console.warn("Supabase signInAnonymously não ativado no painel ou indisponível:", err);
          }
        }

        if (activeSession?.user) {
          if (isMounted) {
            setSession(activeSession);
            setUser(activeSession.user);
          }
          await loadUserData(activeSession.user);
        } else {
          // Fallback guest user if anonymous auth is disabled in Supabase dashboard
          let guestId = typeof window !== "undefined" ? localStorage.getItem("rotas_guest_id") : null;
          if (!guestId) {
            guestId = "guest_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
            if (typeof window !== "undefined") localStorage.setItem("rotas_guest_id", guestId);
          }
          const guestUser: User = {
            id: guestId,
            app_metadata: { provider: "anonymous" },
            user_metadata: { full_name: "Visitante" },
            aud: "authenticated",
            created_at: new Date().toISOString(),
            is_anonymous: true,
          } as unknown as User;

          if (isMounted) {
            setSession(null);
            setUser(guestUser);
          }
        }
      } catch (err) {
        console.error("Auth init error:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (s?.user) {
        setSession(s);
        setUser(s.user);
        await loadUserData(s.user);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(mapAuthError(error.message));
  };

  // Redirects the browser to the provider's consent screen; Supabase then
  // sends the user to /auth/callback with a code we exchange for a session.
  // Provider must be enabled in Supabase Dashboard > Authentication >
  // Providers first (see setup instructions).
  const loginWithOAuth = async (provider: "google") => {
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    if (error) throw new Error(mapAuthError(error.message));
  };

  const signup = async (email: string, password: string, fullName: string) => {
    if (user?.is_anonymous) {
      // Convert anonymous account into permanent email/password user
      // preserving exact user.id and all accumulated progress/preferences!
      const { data, error } = await supabase.auth.updateUser({
        email,
        password,
        data: { full_name: fullName },
      });
      if (error) throw new Error(mapAuthError(error.message));

      // Save profile name
      if (data.user) {
        await supabase.from("profiles").upsert({
          id: data.user.id,
          full_name: fullName,
          updated_at: new Date().toISOString(),
        });
        await loadUserData(data.user);
      }
      return { needsEmailConfirmation: false };
    } else {
      // Standard signup for brand new session
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw new Error(mapAuthError(error.message));
      return { needsEmailConfirmation: !data.session };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    // Clear points cache so a different user doesn't inherit the previous
    // user's cached condition state (points + relatos aggregation).
    clearPointsCache();
    // Re-create anonymous session so the app immediately continues working
    const { data } = await supabase.auth.signInAnonymously();
    if (data.session) {
      setSession(data.session);
      setUser(data.session.user);
      await loadUserData(data.session.user);
    }
  };

  const updatePreferences = async (prefs: EditablePreferences) => {
    if (!user) return;
    const { data, error } = await supabase
      .from("accessibility_preferences")
      .upsert({ user_id: user.id, ...prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw error;
    if (data) setPreferences(data as AccessibilityPreferencesRow);
  };

  const refreshProfile = async () => {
    if (user) await loadUserData(user);
  };

  return (
    <AuthContext.Provider
      value={{ user, session, profile, preferences, loading, isAnonymous, login, loginWithOAuth, signup, logout, updatePreferences, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
