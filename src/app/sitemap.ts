import type { MetadataRoute } from "next";
import { fetchPublicPontos } from "@/lib/pontosPublic";
import { absoluteUrl } from "@/lib/siteConfig";

// Revalida junto com as páginas públicas: um ponto novo cadastrado no painel
// entra no sitemap sem deploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pontos = await fetchPublicPontos();

  // lastModified real: vem de pontos.atualizado_em (trigger no banco), não de
  // "new Date()" — data falsa em sitemap é sinal ruim para crawler.
  const pontoEntries: MetadataRoute.Sitemap = pontos.map((ponto) => ({
    url: absoluteUrl(`/pontos/${ponto.slug}`),
    lastModified: ponto.atualizadoEm ? new Date(ponto.atualizadoEm) : undefined,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  const maisRecente = pontos
    .map((p) => (p.atualizadoEm ? new Date(p.atualizadoEm).getTime() : 0))
    .reduce((max, t) => Math.max(max, t), 0);

  return [
    {
      url: absoluteUrl("/"),
      lastModified: maisRecente ? new Date(maisRecente) : undefined,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/pontos"),
      lastModified: maisRecente ? new Date(maisRecente) : undefined,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...pontoEntries,
  ];
}
