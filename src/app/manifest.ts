import type { MetadataRoute } from "next";
import { LANG, SITE_DESCRIPTION, SITE_NAME } from "@/lib/siteConfig";

/**
 * Web App Manifest gerado em /manifest.webmanifest (substitui o
 * public/manifest.json anterior, que tinha só um ícone .ico).
 *
 * PENDENTE (depende de arquivo do responsável): ícones PNG 192/512 e uma
 * variante `maskable` de verdade. Hoje as entradas apontam para os ícones
 * gerados em /icon-192.png e /icon-512.png (ImageResponse, ver
 * src/app/icon-192.png/route.tsx), o que satisfaz os requisitos de instalação
 * do PWA; quando houver a marca em PNG, é só trocar o `src`.
 *
 * `orientation` continua "portrait" para não mudar sozinho um comportamento
 * definido pelo responsável — mas registre que travar orientação é falha de
 * WCAG 2.2 AA (1.3.4) e está na lista de decisões pendentes da AUDITORIA.md.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${SITE_NAME} — Turismo acessível em Governador Valadares`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: LANG,
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FAF8F5",
    theme_color: "#ff7f00",
    categories: ["travel", "navigation", "education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
    ],
  };
}
