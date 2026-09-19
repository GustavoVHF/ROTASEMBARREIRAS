import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

// Subdomain that serves the admin panel. Overridable via env for local/
// preview testing (e.g. admin.localhost:3000, admin-preview.vercel.app).
const ADMIN_HOST = process.env.NEXT_PUBLIC_ADMIN_HOST || "admin.rotasembarreiras.com.br";

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  // Strip port for local dev (e.g. "admin.localhost:3000" -> "admin.localhost").
  const hostname = host.split(":")[0];
  const isAdminHost = hostname === ADMIN_HOST || hostname === ADMIN_HOST.split(":")[0];

  const { pathname } = request.nextUrl;

  if (isAdminHost) {
    // admin.rotasembarreiras.com.br/* -> internally served by /admin/*.
    // Users on this subdomain never see "/admin" in the URL.
    const response = !pathname.startsWith("/admin")
      ? await (async () => {
          const rewriteUrl = request.nextUrl.clone();
          rewriteUrl.pathname = `/admin${pathname === "/" ? "" : pathname}`;
          return updateSession(request, rewriteUrl);
        })()
      : await updateSession(request);

    // O painel é área logada: nunca deve ser indexado. Cabeçalho em vez de
    // `metadata.robots` porque os layouts de /admin são client components e
    // não podem exportar metadata.
    response.headers.set("x-robots-tag", "noindex, nofollow");
    return response;
  }

  // Main domain (and any other host) never gets to see /admin/* — the
  // route group only resolves through the subdomain rewrite above. This
  // stops the panel from being reachable at rotasembarreiras.com.br/admin.
  if (pathname.startsWith("/admin")) {
    // 404 DE VERDADE (antes era um rewrite para /404, que responde 200 com
    // cara de 404 — "soft 404", que o Google trata como conteúdo duplicado /
    // sinal ruim). Middleware não consegue renderizar o not-found do App
    // Router com status 404, então devolvemos uma página mínima com o status
    // correto e noindex.
    return new NextResponse(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<meta name="robots" content="noindex, nofollow">` +
        `<title>Página não encontrada</title></head>` +
        `<body style="font-family:system-ui,sans-serif;background:#FAF8F5;color:#222E2D;margin:0;padding:48px">` +
        `<h1 style="font-size:1.5rem;margin:0 0 12px">Página não encontrada</h1>` +
        `<p style="margin:0 0 16px;line-height:1.6">Este endereço não existe neste domínio.</p>` +
        `<p style="margin:0"><a href="/" style="color:#cc6600">Voltar para o início</a></p>` +
        `</body></html>`,
      {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" },
      }
    );
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    // Além dos assets, ficam fora do proxy as rotas públicas de SEO
    // (robots/sitemap/llms/manifest/ícones/OG) e as páginas estáticas dos
    // pontos: elas não precisam de sessão Supabase e devem permanecer
    // cacheáveis para crawler.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|llms.txt|opengraph-image|icon-192.png|icon-512.png|pontos|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
