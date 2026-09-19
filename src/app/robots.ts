import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/siteConfig";

/**
 * robots.txt — gerado em /robots.txt.
 *
 * ESTRATÉGIA PARA IAs (nomes conferidos na documentação oficial de cada
 * empresa em 19/09/2026):
 *
 *  - Busca/resposta → OAI-SearchBot (OpenAI), Claude-SearchBot (Anthropic),
 *    PerplexityBot. É o que dá elegibilidade a aparecer e ser CITADO nas
 *    respostas. Bloquear aqui é atirar no próprio pé.
 *  - Disparados pelo usuário → ChatGPT-User, Claude-User, Perplexity-User.
 *    Alguém pede "abra esse link"; sem acesso, a IA não lê a página.
 *  - Treinamento → GPTBot, ClaudeBot, CCBot, Google-Extended,
 *    Applebot-Extended. Não afetam ranking no Google nem AI Overviews
 *    (Google-Extended controla uso em Gemini/grounding, não indexação).
 *
 * DECISÃO ATUAL: liberar tudo, inclusive treinamento. O objetivo do projeto é
 * difundir informação de acessibilidade de utilidade pública, e conteúdo em
 * treino aumenta a chance de os modelos conhecerem a rota mesmo sem citar.
 *
 * PARA BLOQUEAR TREINAMENTO (decisão pendente do responsável): troque
 * ALLOW_AI_TRAINING para false. Nada mais precisa mudar.
 */
const ALLOW_AI_TRAINING = true;

const AI_SEARCH_AGENTS = ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"];
const AI_USER_AGENTS = ["ChatGPT-User", "Claude-User", "Perplexity-User"];
const AI_TRAINING_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
];

// Rotas que nunca devem ser rastreadas: painel administrativo e o callback de
// autenticação (sem conteúdo, e com parâmetros de sessão na URL).
const PRIVATE_PATHS = ["/admin", "/admin/", "/auth/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: AI_SEARCH_AGENTS, allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: AI_USER_AGENTS, allow: "/", disallow: PRIVATE_PATHS },
      ALLOW_AI_TRAINING
        ? { userAgent: AI_TRAINING_AGENTS, allow: "/", disallow: PRIVATE_PATHS }
        : { userAgent: AI_TRAINING_AGENTS, disallow: "/" },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
