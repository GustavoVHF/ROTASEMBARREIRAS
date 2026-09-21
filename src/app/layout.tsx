import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Lexend } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { AuthProvider } from "@/context/AuthContext";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import VLibrasProvider from "@/components/VLibrasProvider";
import {
  LANG,
  LOCALE,
  ORGANIZATION,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  absoluteUrl,
} from "@/lib/siteConfig";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
});

// Reading font for the "modo dislexia" of the Central de Acessibilidade.
// Lexend was designed to improve reading proficiency (wide apertures, low
// letter similarity), which is why it's used instead of the app's display
// font. preload: false on purpose — the file is only fetched when a user
// actually turns the mode on, so default visitors pay nothing for it.
const lexend = Lexend({
  variable: "--font-dyslexia",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  // metadataBase resolve TODAS as URLs relativas de canonical/OG. Sem ela o
  // Next emite OG relativo, que redes sociais e crawlers ignoram.
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: ORGANIZATION.name }],
  creator: ORGANIZATION.name,
  publisher: ORGANIZATION.name,
  keywords: [
    "turismo acessível",
    "acessibilidade",
    "Governador Valadares",
    "pontos turísticos",
    "cadeirante",
    "Libras",
    "audiodescrição",
  ],
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  openGraph: {
    type: "website",
    locale: LOCALE,
    siteName: SITE_NAME,
    url: SITE_URL,
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  // Ícones do navegador: exatamente os originais do projeto (favicon.ico +
  // logorotas.ico). Os PNGs gerados em /icon-192.png e /icon-512.png existem
  // só para a instalação do PWA (src/app/manifest.ts) e não entram aqui, para
  // não substituir o ícone da aba.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/logorotas.ico" },
    ],
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: SITE_NAME,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Nenhum maximumScale/userScalable: o zoom do sistema continua livre
  // (WCAG 2.2 AA 1.4.4 — ampliar até 200% sem perda de função).
  viewportFit: "cover",
  // Declarar o esquema evita que o navegador force um dark mode automático
  // sobre uma paleta que não foi desenhada para ele.
  colorScheme: "light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ff7f00" },
    { media: "(prefers-color-scheme: dark)", color: "#ff7f00" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang={LANG}
      dir="ltr"
      suppressHydrationWarning
      className={`${plusJakartaSans.variable} ${lexend.variable} h-full select-none antialiased`}
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="shortcut icon" href="/favicon.ico" />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-bg-app text-text-main">
        {/* JSON-LD de identidade do website. Só descreve o que está visível:
            nome, propósito, idioma e autoria. Sem SearchAction porque a busca
            atual é interna ao mapa e não tem URL de resultado própria —
            declarar um endpoint que não existe é erro de dados estruturados. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "WebSite",
                  "@id": `${SITE_URL}/#website`,
                  url: SITE_URL,
                  name: SITE_NAME,
                  description: SITE_DESCRIPTION,
                  inLanguage: LANG,
                  publisher: { "@id": `${SITE_URL}/#organization` },
                },
                {
                  "@type": "Organization",
                  "@id": `${SITE_URL}/#organization`,
                  name: ORGANIZATION.name,
                  description: ORGANIZATION.description,
                  url: SITE_URL,
                  logo: absoluteUrl("/icon-512.png"),
                },
              ],
            }).replace(/</g, "\\u003c"),
          }}
        />
        <AuthProvider>
          {children}
          <VLibrasProvider />
        </AuthProvider>
        {/* Medição de uso por eventos (PostHog). Não renderiza nada e fica
            desligada sem NEXT_PUBLIC_POSTHOG_KEY. */}
        <AnalyticsProvider />
        <Analytics />
      </body>
    </html>
  );
}
