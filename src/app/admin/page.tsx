"use client";

import React from "react";
import Link from "next/link";
import { MapPinned, ListChecks, ArrowRight } from "lucide-react";

const CARDS = [
  {
    href: "/admin/pontos",
    icon: MapPinned,
    title: "Pontos",
    description: "Listar, editar e cadastrar pontos turísticos do mapa.",
  },
  {
    href: "/admin/sugestoes",
    icon: ListChecks,
    title: "Sugestões",
    description: "Aprovar ou rejeitar locais sugeridos por usuários.",
  },
];

export default function AdminHomePage() {
  return (
    <main className="w-full min-h-full bg-bg-app py-8 px-4 sm:px-6 flex flex-col items-center">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <h1 className="text-2xl font-black text-text-main">Painel administrativo</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CARDS.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md flex flex-col gap-3 hover:shadow-lg transition-shadow"
            >
              <span className="w-12 h-12 rounded-full bg-brand-light text-brand flex items-center justify-center">
                <Icon className="w-6 h-6" />
              </span>
              <div>
                <h2 className="text-base font-black text-text-main flex items-center gap-1.5">
                  {title}
                  <ArrowRight className="w-4 h-4" />
                </h2>
                <p className="mt-1 text-sm text-text-secondary font-medium leading-relaxed">{description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
