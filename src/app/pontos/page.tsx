import type { Metadata } from "next";
import Link from "next/link";
import { fetchPublicPontos, pontoSummary } from "@/lib/pontosPublic";
import { absoluteUrl, CITY, SITE_NAME, STATE } from "@/lib/siteConfig";

// Server Component com ISR: o HTML sai pronto do servidor (indexável e legível
// por IAs que não executam JavaScript) e revalida de hora em hora, então um
// ponto cadastrado no painel aparece aqui sozinho.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: `Pontos turísticos acessíveis em ${CITY}`,
  description: `Lista completa dos pontos turísticos, culturais e naturais de ${CITY} (${STATE}) mapeados pelo ${SITE_NAME}, com endereço, como chegar e informações de acessibilidade.`,
  alternates: { canonical: "/pontos" },
  openGraph: {
    title: `Pontos turísticos acessíveis em ${CITY} | ${SITE_NAME}`,
    description: `Lista completa dos pontos mapeados pelo ${SITE_NAME}, com endereço e informações de acessibilidade.`,
    url: absoluteUrl("/pontos"),
  },
};

export default async function PontosIndexPage() {
  const pontos = await fetchPublicPontos();

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Pontos turísticos", item: absoluteUrl("/pontos") },
    ],
  };

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Pontos turísticos acessíveis em ${CITY}`,
    numberOfItems: pontos.length,
    itemListElement: pontos.map((ponto, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: ponto.nome,
      url: absoluteUrl(`/pontos/${ponto.slug}`),
    })),
  };

  return (
    <main className="min-h-dvh bg-bg-app px-5 py-10 sm:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb).replace(/</g, "\\u003c") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList).replace(/</g, "\\u003c") }}
      />

      <div className="mx-auto w-full max-w-3xl">
        <nav aria-label="Você está em" className="text-sm font-semibold text-text-secondary">
          <Link href="/" className="underline hover:text-brand">
            Início
          </Link>
          <span aria-hidden="true"> › </span>
          <span>Pontos turísticos</span>
        </nav>

        <h1 className="mt-4 text-3xl font-black text-text-main leading-tight">
          Pontos turísticos acessíveis em {CITY}
        </h1>
        <p className="mt-3 text-base text-text-secondary font-medium leading-relaxed">
          Cada página reúne o que é o local, onde fica, como chegar e quais recursos de
          acessibilidade constam no cadastro. Os dados de acessibilidade estão em processo de
          validação em campo pela ONG UAI.
        </p>
        <p className="mt-3 text-base font-semibold">
          <Link href="/" className="text-brand underline hover:text-brand-dark">
            Abrir o mapa interativo do {SITE_NAME}
          </Link>
        </p>

        {pontos.length === 0 ? (
          <p className="mt-10 text-base text-text-secondary font-medium">
            Nenhum ponto publicado no momento.
          </p>
        ) : (
          <ul className="mt-8 flex flex-col gap-4">
            {pontos.map((ponto) => (
              <li key={ponto.id} className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
                <h2 className="text-xl font-black text-text-main leading-snug">
                  <Link href={`/pontos/${ponto.slug}`} className="underline hover:text-brand">
                    {ponto.nome}
                  </Link>
                </h2>
                <p className="mt-1 text-sm font-bold text-text-secondary">
                  {[ponto.categoria, ponto.cidade].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-2.5 text-base text-text-secondary font-medium leading-relaxed">
                  {pontoSummary(ponto)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
