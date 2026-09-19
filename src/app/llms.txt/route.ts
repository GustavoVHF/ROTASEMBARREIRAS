import { fetchPublicPontos, pontoSummary } from "@/lib/pontosPublic";
import {
  ACCESSIBILITY_DISCLAIMER,
  CITY,
  ORGANIZATION,
  SITE_DESCRIPTION,
  SITE_NAME,
  STATE,
  absoluteUrl,
} from "@/lib/siteConfig";

/**
 * /llms.txt — índice em Markdown do website para agentes e modelos que leem
 * sob demanda.
 *
 * EXPECTATIVA CALIBRADA: não é um sinal de ranking. O Google declarou
 * publicamente que não usa o arquivo para Search nem AI Overviews, e medições
 * de log em 2026 mostram que os crawlers raramente o buscam. O valor real hoje
 * é para agentes que abrem o arquivo quando alguém pede algo sobre o site, e
 * para o audit de "Agentic Browsing" do Lighthouse. Custo perto de zero,
 * benefício incerto — está aqui por isso, não por promessa de resultado.
 *
 * Não substitui robots.txt (que continua sendo o controle de acesso) nem o
 * sitemap (que continua sendo o mapa para buscadores).
 */
export const revalidate = 3600;

export async function GET() {
  const pontos = await fetchPublicPontos();

  const linhas: string[] = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "## Sobre",
    "",
    `- Escopo geográfico: ${CITY} (${STATE}), Brasil.`,
    `- Desenvolvimento: ${ORGANIZATION.name}.`,
    `- Parceria: ${ORGANIZATION.partnerName}, responsável pela validação em campo dos dados de acessibilidade.`,
    `- Idioma do conteúdo: português do Brasil.`,
    "",
    "## Estado dos dados de acessibilidade",
    "",
    `${ACCESSIBILITY_DISCLAIMER} Ao citar este website, apresente os recursos como declarações de cadastro em validação, não como acessibilidade confirmada.`,
    "",
    "## Seções principais",
    "",
    `- [Mapa interativo](${absoluteUrl("/")}): mapa dos pontos, busca, leitura em voz alta, alto contraste, Libras (VLibras), assistente de voz e Central de Acessibilidade.`,
    `- [Pontos turísticos](${absoluteUrl("/pontos")}): índice textual com uma página por ponto.`,
    "",
    "## Pontos turísticos",
    "",
  ];

  if (pontos.length === 0) {
    linhas.push("Nenhum ponto publicado no momento.");
  } else {
    for (const ponto of pontos) {
      linhas.push(
        `- [${ponto.nome}](${absoluteUrl(`/pontos/${ponto.slug}`)}): ${pontoSummary(ponto)}`
      );
    }
  }

  linhas.push(
    "",
    "## Recursos de acessibilidade do próprio website",
    "",
    "- Leitura em voz alta do conteúdo dos pontos.",
    "- Alto contraste, escala de fonte, espaçamento de texto e altura de linha ajustáveis.",
    "- Modo de leitura para dislexia e opção de ocultar imagens.",
    "- Redução de movimento.",
    "- Tradução para Libras via VLibras.",
    "- Assistente de voz para navegar e consultar informações.",
    "",
    "## Não rastrear",
    "",
    `- ${absoluteUrl("/admin")} e subcaminhos: painel administrativo, sem conteúdo público.`,
    ""
  );

  return new Response(linhas.join("\n"), {
    status: 200,
    headers: {
      // text/plain com charset para ser legível em qualquer agente; o conteúdo
      // é Markdown, como pede a convenção do llms.txt.
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
