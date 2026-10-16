"use client";

import React from "react";
import { Accessibility } from "lucide-react";
import type { ConsensoRecursoRow } from "@/types/database";
import { COMMUNITY_RESOURCES } from "@/lib/communityResources";
import AccessibilityDetailItem from "@/components/point/AccessibilityDetailItem";

export function communityCaption(n: number): string {
  return `Relatado pela comunidade (${n} ${n === 1 ? "pessoa" : "pessoas"})`;
}

/**
 * Recursos de acessibilidade de um ponto em mapeamento, nos três estados
 * (tem / não tem / não verificado). O estado vem do consenso dos relatos da
 * comunidade (public.consenso_recursos); sem consenso, "não verificado".
 * Nunca é apresentado como verificação oficial. `children` = link e
 * formulário de relato.
 */
export default function CommunityAccessibilityCard({
  consensus,
  children,
}: {
  consensus: ConsensoRecursoRow[];
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md">
      <h3 className="text-xl font-black text-text-main flex items-center gap-2 border-b border-gray-100 pb-4 mb-5">
        <Accessibility className="w-6 h-6 text-brand" aria-hidden="true" />
        Acessibilidade relatada pela comunidade
      </h3>
      <ul className="space-y-4">
        {COMMUNITY_RESOURCES.map((r) => {
          const c = consensus.find((x) => x.recurso === r.key);
          return (
            <AccessibilityDetailItem
              key={r.key}
              detail={{ texto: r.label, estado: c ? c.estado : "nao_verificado" }}
              caption={c ? communityCaption(c.apoiadores) : undefined}
            />
          );
        })}
      </ul>
      {children}
    </div>
  );
}
