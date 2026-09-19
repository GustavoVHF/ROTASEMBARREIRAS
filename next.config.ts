import type { NextConfig } from "next";

// Host do Storage do Supabase (imagens dos pontos), derivado da mesma env var
// usada pelo client — evita duplicar o project ref em outro lugar.
const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  // next/image nas páginas públicas (/pontos/[slug]) precisa autorizar o host
  // remoto das imagens de capa/galeria.
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  // Não anunciar a stack em header de resposta.
  poweredByHeader: false,
};

export default nextConfig;
