/**
 * Camada única de analytics do website.
 *
 * REGRAS QUE ESTE ARQUIVO GARANTE (nenhum componente fala com o PostHog
 * diretamente — todos passam por `track`):
 *
 *  - Sem chave configurada, o analytics simplesmente não existe: `track` é
 *    no-op. O website nunca quebra nem registra erro por causa de medição.
 *  - Nenhum dado pessoal sai daqui. Só id de registro, categoria, cidade,
 *    contadores e duração. Nome do usuário, e-mail, coordenadas, áudio e
 *    texto livre (busca, relato) NUNCA são enviados.
 *  - Os nomes de evento são um tipo fechado (AnalyticsEvent), então errar o
 *    nome de um evento é erro de compilação, não dado perdido no painel.
 *
 * Sobre "nome do ponto": é dado público do cadastro (aparece no mapa, no
 * sitemap e nas páginas indexáveis), não dado do usuário — por isso pode ir.
 */

import type { PostHog } from "posthog-js";

/** Eventos permitidos. Adicionar evento novo exige entrar nesta lista. */
export type AnalyticsEvent =
  | "ponto_aberto"
  | "como_chegar_clicado"
  | "trilha_iniciada"
  | "trilha_concluida"
  | "filtro_aplicado"
  | "menu_acessibilidade_usado"
  | "vlibras_ativado"
  | "assistente_voz_iniciado"
  | "assistente_voz_encerrado"
  | "relato_enviado"
  | "busca_realizada"
  | "pwa_instalado";

/** Recursos do menu de acessibilidade que reportam uso. */
export type AccessibilityFeature =
  | "contraste"
  | "fonte"
  | "leitura_em_voz"
  | "reduzir_movimento"
  | "saturacao"
  | "espacamento_texto"
  | "altura_linha"
  | "ocultar_imagens"
  | "modo_dislexia";

/**
 * Propriedades aceitas por evento — só primitivos, um campo por linha, para a
 * auditoria de privacidade ser um relance. O que não está declarado aqui não
 * é enviado (TypeScript recusa propriedade extra).
 */
interface EventProperties {
  ponto_aberto: { ponto_id: string; nome: string; cidade: string; categoria: string };
  como_chegar_clicado: { ponto_id: string; aplicativo: string };
  trilha_iniciada: { trilha_id: string; cidade: string };
  trilha_concluida: { trilha_id: string; cidade: string; paradas: number };
  /** `tipo` = que espécie de filtro foi usado (hoje: "categoria"). */
  filtro_aplicado: { tipo: string; valor: string };
  menu_acessibilidade_usado: { recurso: AccessibilityFeature; valor: string };
  vlibras_ativado: { ativo: boolean };
  assistente_voz_iniciado: Record<string, never> | undefined;
  assistente_voz_encerrado: { duracao_segundos: number };
  /** Nunca o texto do relato — só o tipo e o tamanho. */
  relato_enviado: { ponto_id: string; tipo: "ok" | "problema"; caracteres: number };
  /** Nunca o texto digitado — só o tipo de resultado e o tamanho da consulta. */
  busca_realizada: { tipo: "ponto" | "endereco"; caracteres: number };
  pwa_instalado: Record<string, never> | undefined;
}

let client: PostHog | null = null;
let initialized = false;

function readConfig(): { key: string; host: string } | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  return { key, host };
}

/** true quando existe chave configurada (útil para logs/diagnóstico). */
export function isAnalyticsConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * Inicializa o PostHog UMA vez, no navegador. Sem chave, não faz nada e o
 * website segue normal. Chamar de novo é inofensivo.
 *
 * Configuração de privacidade (mesma descrita na Política de Privacidade):
 *  - persistence "memory": nada em cookie nem em localStorage; ao fechar a
 *    aba, o identificador temporário desaparece;
 *  - autocapture desligado: nenhum clique/campo é capturado automaticamente;
 *  - capture_pageview desligado: a URL do website é única, pageview não diz
 *    nada — a medição é por evento;
 *  - disable_session_recording: nenhuma gravação de tela ou de sessão;
 *  - respect_dnt: honra "Do Not Track" do navegador;
 *  - person_profiles "identified_only": como nunca chamamos identify(), não
 *    são criados perfis de pessoas.
 */
export async function initAnalytics(): Promise<void> {
  if (initialized || typeof window === "undefined") return;
  const config = readConfig();
  if (!config) return;

  initialized = true;
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.init(config.key, {
      api_host: config.host,
      persistence: "memory",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      respect_dnt: true,
      person_profiles: "identified_only",
    });
    client = posthog;
  } catch {
    // Bloqueador de rastreamento, rede indisponível, script barrado: o
    // analytics fica desligado e o website continua igual.
    client = null;
  }
}

/**
 * Registra um evento de uso. Silencioso por definição: sem PostHog
 * inicializado (sem chave, DNT ligado, bloqueador ativo) não faz nada e não
 * lança.
 */
export function track<E extends AnalyticsEvent>(event: E, properties?: EventProperties[E]): void {
  if (!client) return;
  try {
    client.capture(event, properties);
  } catch {
    // Medição nunca pode interromper uma ação do usuário.
  }
}
