"use client";

import React from "react";
import { Loader2, ShieldAlert, MapPinned, ListChecks, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const NAV_ITEMS = [
  { href: "/admin", label: "Início", icon: LayoutDashboard },
  { href: "/admin/pontos", label: "Pontos", icon: MapPinned },
  { href: "/admin/sugestoes", label: "Sugestões", icon: ListChecks },
];

/**
 * Guard + shell for every /admin/* route. Blocks:
 *  - anonymous/guest sessions (isAnonymous or no real user)
 *  - authenticated accounts without profiles.is_admin = true
 *
 * This is a client-side UX gate only — the real enforcement is the
 * is_admin() RLS policies on pontos/sugestoes_locais (see
 * supabase/migrations_admin.sql). Even if someone bypassed this layout,
 * every write would still be rejected server-side.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, isAnonymous, loading } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <main className="w-full min-h-dvh bg-bg-app flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </main>
    );
  }

  const isAdmin = !!user && !isAnonymous && profile?.is_admin === true;

  if (!isAdmin) {
    return (
      <main className="w-full min-h-dvh bg-bg-app flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-md max-w-md w-full flex flex-col items-center text-center gap-3">
          <span className="w-14 h-14 rounded-full bg-brand-light text-brand flex items-center justify-center">
            <ShieldAlert className="w-7 h-7" />
          </span>
          <h1 className="text-lg font-black text-text-main">Acesso restrito</h1>
          <p className="text-sm text-text-secondary font-medium leading-relaxed">
            Este painel é exclusivo para administradores. Entre com uma conta autorizada para continuar.
          </p>
          <a
            href="https://rotasembarreiras.com.br"
            className="mt-2 text-sm font-bold text-brand hover:text-brand-dark"
          >
            Ir para o app principal
          </a>
        </div>
      </main>
    );
  }

  return (
    // SCROLL CONTRACT: globals.css sets `html { overflow: hidden }` for the
    // PWA shell, so no admin page can rely on page-level scroll (that's what
    // made the cadastro form unreachable below the fold). The shell is a fixed
    // h-dvh flex column and the <main> below is the ONE scroll container for
    // every /admin route — pages must use min-h-full, never min-h-dvh.
    <div className="w-full h-dvh overflow-hidden bg-bg-app flex flex-col">
      <header className="flex-shrink-0 bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-black text-text-main">Rota sem Barreiras · Admin</h1>
        <nav className="flex items-center gap-1.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  active ? "bg-brand-light text-brand" : "text-text-secondary hover:bg-gray-50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  );
}
