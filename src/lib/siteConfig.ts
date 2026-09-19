/**
 * Identidade canônica do website, usada por metadados, sitemap, robots,
 * llms.txt e JSON-LD. Um lugar só para não haver divergência entre o que o
 * usuário vê, o que o Google indexa e o que uma IA cita.
 *
 * NEXT_PUBLIC_SITE_URL permite apontar para preview/local sem editar código.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://rotasembarreiras.com.br").replace(
  /\/$/,
  ""
);

export const SITE_NAME = "Rota sem Barreiras";

export const SITE_TAGLINE = "Turismo acessível em Governador Valadares (MG)";

/** Descrição factual, escrita para ser resumida com fidelidade por pessoas e
 * por modelos de linguagem. Sem superlativo, sem promessa. */
export const SITE_DESCRIPTION =
  "Website de turismo acessível de Governador Valadares (MG): pontos culturais, " +
  "patrimoniais e naturais com endereço, como chegar, informações de acessibilidade " +
  "e recursos de leitura, alto contraste, Libras e áudio. Projeto da Carnelian " +
  "Escuderia em parceria com a ONG UAI (União dos Amigos da Inclusão).";

export const CITY = "Governador Valadares";
export const STATE = "MG";
export const COUNTRY = "BR";
export const LOCALE = "pt_BR";
export const LANG = "pt-BR";

/** Autoria institucional. A Carnelian desenvolve o website; a UAI é a parceira
 * responsável pela validação em campo dos dados de acessibilidade. */
export const ORGANIZATION = {
  name: "Carnelian Escuderia",
  description:
    "Equipe estudantil de STEM Racing / F1 in Schools responsável pelo desenvolvimento do website Rota sem Barreiras.",
  partnerName: "ONG UAI — União dos Amigos da Inclusão",
};

/**
 * Aviso padrão sobre o estado dos dados de acessibilidade. Enquanto a UAI não
 * concluir a validação em campo, NENHUM texto público e NENHUM JSON-LD pode
 * afirmar que um recurso existe: o cadastro é apresentado como declaração em
 * validação. Usado igual em HTML visível e em `accessibilitySummary`.
 */
export const ACCESSIBILITY_DISCLAIMER =
  "As informações de acessibilidade abaixo vêm do cadastro do website e estão em " +
  "processo de validação em campo pela ONG UAI. Confirme no local antes de se deslocar.";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
