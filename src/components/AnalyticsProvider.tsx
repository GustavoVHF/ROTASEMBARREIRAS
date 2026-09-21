"use client";

import { useEffect } from "react";
import { initAnalytics, track } from "@/lib/analytics";

/**
 * Inicializa o analytics do website UMA vez e escuta a instalação do PWA.
 *
 * Não renderiza nada: nenhum elemento, nenhuma classe, nenhum efeito visual.
 * Sem NEXT_PUBLIC_POSTHOG_KEY, `initAnalytics` não faz nada e este componente
 * segue sendo um provider vazio.
 *
 * A inicialização é dinâmica (import() dentro de initAnalytics), então o
 * pacote do PostHog não entra no bundle inicial do website.
 */
export default function AnalyticsProvider() {
  useEffect(() => {
    initAnalytics();

    // "appinstalled" é o único sinal confiável de instalação do PWA, e é
    // disparado pelo próprio navegador — nada de UI nova aqui.
    const onInstalled = () => track("pwa_instalado");
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  return null;
}
