import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Lexend } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { AuthProvider } from "@/context/AuthContext";
import VLibrasProvider from "@/components/VLibrasProvider";

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
  title: "Rota sem Barreiras | Turismo Acessível GV",
  description: "Protótipo de turismo acessível e inclusão cultural de Governador Valadares (MG) - Parceria Carnelian & ONG UAI",
  manifest: "/manifest.json",
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
    title: "Rota sem Barreiras",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ff7f00",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${plusJakartaSans.variable} ${lexend.variable} h-full select-none antialiased`}
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="shortcut icon" href="/favicon.ico" />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-bg-app text-text-main">
        <AuthProvider>
          {children}
          <VLibrasProvider />
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
