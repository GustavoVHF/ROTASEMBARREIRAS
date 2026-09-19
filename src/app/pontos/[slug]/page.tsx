import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  ESTADO_LABEL,
  fetchPublicPontoBySlug,
  fetchPublicPontos,
  pontoSummary,
  type PublicPonto,
} from "@/lib/pontosPublic";
import {
  ACCESSIBILITY_DISCLAIMER,
  CITY,
  COUNTRY,
  ORGANIZATION,
  SITE_NAME,
  STATE,
  absoluteUrl,
} from "@/lib/siteConfig";

/**
 * Página pública de um ponto turístico — a versão indexável do MESMO conteúdo
 * que o website mostra no mapa. Renderizada no servidor (SSG + ISR), então
 * Googlebot e os fetchers de IA que não executam JavaScript leem tudo.
 *
 * Nada aqui é escondido de robô nem mostrado só para robô: o texto, o JSON-LD
 * e o que a pessoa lê são a mesma informação. Os dados de acessibilidade
 * aparecem como DECLARAÇÃO DE CADASTRO em validação pela UAI — nem o HTML nem
 * o JSON-LD afirmam que o recurso existe.
 */
export const revalidate = 3600;

export async function generateStaticParams() {
  const pontos = await fetchPublicPontos();
  return pontos.map((ponto) => ({ slug: ponto.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const ponto = await fetchPublicPontoBySlug(slug);
  if (!ponto) return { title: "Ponto não encontrado", robots: { index: false, follow: true } };

  const title = `${ponto.nome} — acessibilidade, endereço e como chegar`;
  const description = pontoSummary(ponto).slice(0, 300);
  const url = absoluteUrl(`/pontos/${ponto.slug}`);

  return {
    title,
    description,
    alternates: { canonical: `/pontos/${ponto.slug}` },
    openGraph: {
      title: `${ponto.nome} | ${SITE_NAME}`,
      description,
      url,
      type: "article",
      ...(ponto.imagemCapa ? { images: [{ url: ponto.imagemCapa, alt: ponto.nome }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: `${ponto.nome} | ${SITE_NAME}`,
      description,
      ...(ponto.imagemCapa ? { images: [ponto.imagemCapa] } : {}),
    },
  };
}

/** Mapeia a categoria do cadastro para o tipo schema.org mais específico que
 * seja defensável. Na dúvida fica em TouristAttraction — errar o tipo é pior
 * que ser genérico. */
function schemaType(categoria: string): string {
  const c = categoria.toLowerCase();
  if (c.includes("museu")) return "Museum";
  if (c.includes("religi") || c.includes("igreja")) return "PlaceOfWorship";
  if (c.includes("natur") || c.includes("parque")) return "Park";
  if (c.includes("gastronom")) return "Restaurant";
  if (c.includes("patrim") || c.includes("cultur")) return "LandmarksOrHistoricalBuildings";
  return "TouristAttraction";
}

function buildJsonLd(ponto: PublicPonto) {
  const place: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": ["TouristAttraction", schemaType(ponto.categoria)].filter(
      (t, i, arr) => arr.indexOf(t) === i
    ),
    "@id": absoluteUrl(`/pontos/${ponto.slug}#place`),
    name: ponto.nome,
    url: absoluteUrl(`/pontos/${ponto.slug}`),
    description: pontoSummary(ponto),
    geo: {
      "@type": "GeoCoordinates",
      latitude: ponto.latitude,
      longitude: ponto.longitude,
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: ponto.endereco ?? undefined,
      addressLocality: ponto.cidade || CITY,
      addressRegion: STATE,
      addressCountry: COUNTRY,
    },
    // IMPORTANTE: accessibilityFeature / accessibilityHazard ficam FORA de
    // propósito. Declarar um recurso aqui equivale a afirmar que ele existe, e
    // a validação em campo da UAI ainda não aconteceu. O resumo abaixo diz
    // exatamente o mesmo que o HTML visível, sem afirmar nada.
    accessibilitySummary: ACCESSIBILITY_DISCLAIMER,
    isPartOf: { "@id": `${absoluteUrl("/")}#website` },
    ...(ponto.imagemCapa ? { image: [ponto.imagemCapa, ...ponto.galeria].slice(0, 6) } : {}),
    ...(ponto.atualizadoEm ? { dateModified: ponto.atualizadoEm } : {}),
  };

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Pontos turísticos", item: absoluteUrl("/pontos") },
      {
        "@type": "ListItem",
        position: 3,
        name: ponto.nome,
        item: absoluteUrl(`/pontos/${ponto.slug}`),
      },
    ],
  };

  return [place, breadcrumb];
}

export default async function PontoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ponto = await fetchPublicPontoBySlug(slug);
  if (!ponto) notFound();

  const declarados = ponto.recursos.filter((r) => r.declared);
  const naoDeclarados = ponto.recursos.filter((r) => !r.declared);
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${ponto.latitude},${ponto.longitude}`;

  return (
    <main className="min-h-dvh bg-bg-app px-5 py-10 sm:px-8">
      {buildJsonLd(ponto).map((jsonLd, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      ))}

      <article className="mx-auto w-full max-w-3xl">
        <nav aria-label="Você está em" className="text-sm font-semibold text-text-secondary">
          <Link href="/" className="underline hover:text-brand">
            Início
          </Link>
          <span aria-hidden="true"> › </span>
          <Link href="/pontos" className="underline hover:text-brand">
            Pontos turísticos
          </Link>
          <span aria-hidden="true"> › </span>
          <span>{ponto.nome}</span>
        </nav>

        <h1 className="mt-4 text-3xl font-black text-text-main leading-tight">{ponto.nome}</h1>
        <p className="mt-2 text-sm font-bold text-text-secondary">
          {[ponto.categoria, ponto.cidade && `${ponto.cidade} - ${STATE}`].filter(Boolean).join(" · ")}
        </p>

        {ponto.imagemCapa && (
          <Image
            src={ponto.imagemCapa}
            alt={`Vista do local ${ponto.nome}`}
            width={1200}
            height={675}
            className="mt-6 w-full h-auto rounded-3xl border border-gray-100 object-cover"
            priority
          />
        )}

        <section className="mt-8" aria-labelledby="sobre">
          <h2 id="sobre" className="text-xl font-black text-text-main">
            O que é
          </h2>
          <p className="mt-2 text-base text-text-main font-medium leading-relaxed">
            {pontoSummary(ponto)}
          </p>
          {ponto.descricaoLonga?.trim() && (
            <p className="mt-3 text-base text-text-secondary font-medium leading-relaxed whitespace-pre-line">
              {ponto.descricaoLonga.trim()}
            </p>
          )}
        </section>

        <section className="mt-8" aria-labelledby="onde">
          <h2 id="onde" className="text-xl font-black text-text-main">
            Onde fica e como chegar
          </h2>
          <p className="mt-2 text-base text-text-main font-medium leading-relaxed">
            {ponto.endereco || `${ponto.cidade || CITY} - ${STATE}`}
          </p>
          <p className="mt-1 text-sm text-text-secondary font-semibold">
            Coordenadas: {ponto.latitude.toFixed(6)}, {ponto.longitude.toFixed(6)}
          </p>
          <p className="mt-3 text-base font-semibold">
            <a
              href={mapsUrl}
              rel="noopener"
              className="text-brand underline hover:text-brand-dark"
            >
              Abrir rota no Google Maps
            </a>
          </p>
        </section>

        <section className="mt-8" aria-labelledby="acessibilidade">
          <h2 id="acessibilidade" className="text-xl font-black text-text-main">
            Acessibilidade
          </h2>
          <p className="mt-2 text-base text-text-secondary font-medium leading-relaxed">
            {ACCESSIBILITY_DISCLAIMER}
          </p>

          {declarados.length > 0 && (
            <>
              <h3 className="mt-5 text-base font-black text-text-main">Declarado no cadastro</h3>
              <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-5">
                {declarados.map((r) => (
                  <li key={r.label} className="text-base text-text-main font-medium">
                    {r.label}
                  </li>
                ))}
              </ul>
            </>
          )}

          {naoDeclarados.length > 0 && (
            <>
              <h3 className="mt-5 text-base font-black text-text-main">
                Sem informação no cadastro
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-5">
                {naoDeclarados.map((r) => (
                  <li key={r.label} className="text-base text-text-secondary font-medium">
                    {r.label}
                  </li>
                ))}
              </ul>
            </>
          )}

          {ponto.detalhes.length > 0 && (
            <>
              <h3 className="mt-5 text-base font-black text-text-main">Itens detalhados</h3>
              <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-5">
                {ponto.detalhes.map((d, i) => (
                  <li key={i} className="text-base text-text-main font-medium">
                    {d.texto} — <span className="text-text-secondary">{ESTADO_LABEL[d.estado]}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {ponto.atualizadoEm && (
            <p className="mt-5 text-sm text-text-secondary font-semibold">
              Cadastro atualizado em{" "}
              <time dateTime={ponto.atualizadoEm}>
                {new Date(ponto.atualizadoEm).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </time>
              .
            </p>
          )}
        </section>

        <section className="mt-8" aria-labelledby="recursos-website">
          <h2 id="recursos-website" className="text-xl font-black text-text-main">
            Recursos de acessibilidade do website
          </h2>
          <p className="mt-2 text-base text-text-secondary font-medium leading-relaxed">
            No mapa interativo este local tem leitura em voz alta do conteúdo, alto contraste,
            ajuste de tamanho e espaçamento de texto, modo de leitura para dislexia, tradução para
            Libras via VLibras e assistente de voz.
          </p>
          <p className="mt-3 text-base font-semibold">
            <Link href="/" className="text-brand underline hover:text-brand-dark">
              Abrir {ponto.nome} no mapa do {SITE_NAME}
            </Link>
          </p>
        </section>

        <footer className="mt-10 border-t border-gray-200 pt-5 text-sm text-text-secondary font-medium leading-relaxed">
          {SITE_NAME} é um projeto da {ORGANIZATION.name} em parceria com a{" "}
          {ORGANIZATION.partnerName}.
        </footer>
      </article>
    </main>
  );
}
