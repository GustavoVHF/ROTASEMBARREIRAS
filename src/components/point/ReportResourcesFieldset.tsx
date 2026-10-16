"use client";

import React, { useId } from "react";
import { Accessibility, Bookmark, Check, HeartHandshake, ShieldCheck, Toilet, type LucideIcon } from "lucide-react";
import type { CommunityResourceKey, RelatoRecursos } from "@/types/database";
import { COMMUNITY_RESOURCES, toggleRecurso } from "@/lib/communityResources";

/** Mesmos ícones dos blocos de "Acessibilidade no Local" dos pontos oficiais. */
const ICONS: Record<CommunityResourceKey, LucideIcon> = {
  entrada: Accessibility,
  banheiro: Toilet,
  braille: ShieldCheck,
  libras: Bookmark,
  atendimento: HeartHandshake,
};

/** Base de 6 colunas: 2+2+2 na primeira linha, 3+3 na segunda (como os oficiais). */
const SPANS = ["col-span-2", "col-span-2", "col-span-2", "col-span-3", "col-span-3"];

/**
 * "O que você viu no local?" — blocos com ícone que a pessoa toca para
 * ligar/desligar (aria-pressed). Ligado = "tem" no relato; desligado = não
 * envia o recurso. O alto contraste usa o atributo aria-pressed (bloco
 * "RELATO — RECURSOS" em globals.css). Sem transição nem escala.
 */
export default function ReportResourcesFieldset({
  value,
  onChange,
}: {
  value: RelatoRecursos;
  onChange: (next: RelatoRecursos) => void;
}) {
  const hintId = useId();

  return (
    <fieldset className="mb-5" aria-describedby={hintId}>
      {/* Texto em <span>: o alto contraste repinta span/p, não legend. */}
      <legend className="text-sm font-bold text-text-main mb-1">
        <span>O que você viu no local? (opcional)</span>
      </legend>
      <p id={hintId} className="text-xs font-semibold text-text-secondary mb-3">
        Toque para marcar o que o local tem.
      </p>
      <div className="grid grid-cols-6 gap-2.5">
        {COMMUNITY_RESOURCES.map((r, i) => {
          const on = value[r.key] === "tem";
          const Icon = ICONS[r.key];
          return (
            <button
              key={r.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleRecurso(value, r.key))}
              className={`rsb-tile ${SPANS[i]} min-h-[88px] min-w-[44px] flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border-2 text-center cursor-pointer ${
                on ? "bg-brand-light border-brand text-brand" : "bg-white border-gray-200 text-text-secondary"
              }`}
            >
              <Icon className="w-7 h-7 flex-shrink-0" aria-hidden={true} />
              <span className="flex items-center justify-center gap-1 text-xs font-black leading-tight">
                {on && <Check className="w-3.5 h-3.5 flex-shrink-0" aria-hidden={true} />}
                {r.short}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
