"use client";

import React from "react";
import type { CommunityResourceKey, RelatoRecursos } from "@/types/database";
import { COMMUNITY_RESOURCES } from "@/lib/communityResources";

type Choice = "tem" | "nao_tem" | "nao_sei";

const OPTIONS: { value: Choice; label: string }[] = [
  { value: "tem", label: "Tem" },
  { value: "nao_tem", label: "Não tem" },
  { value: "nao_sei", label: "Não sei" },
];

/**
 * "O que você viu no local?" — um grupo de rádios nativo por recurso.
 * "Não sei" é o padrão e não envia nada. O estado marcado é só CSS
 * (.rsb-choice:has(input:checked), bloco "RELATO — OPÇÕES" em globals.css),
 * para o alto contraste reconhecer; sem transição.
 */
export default function ReportResourcesFieldset({
  value,
  onChange,
}: {
  value: RelatoRecursos;
  onChange: (next: RelatoRecursos) => void;
}) {
  const set = (key: CommunityResourceKey, choice: Choice) => {
    const next: RelatoRecursos = { ...value };
    if (choice === "nao_sei") delete next[key];
    else next[key] = choice;
    onChange(next);
  };

  return (
    <fieldset className="mb-4">
      <legend className="text-sm font-bold text-text-main mb-3">O que você viu no local? (opcional)</legend>
      <div className="space-y-4">
        {COMMUNITY_RESOURCES.map((r) => {
          const current: Choice = value[r.key] ?? "nao_sei";
          return (
            <fieldset key={r.key}>
              <legend className="text-sm font-semibold text-text-secondary mb-2">{r.label}</legend>
              <div className="flex flex-wrap gap-2">
                {OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className="rsb-choice inline-flex items-center justify-center min-h-12 px-4 rounded-full border-2 border-gray-200 bg-white text-text-main font-bold cursor-pointer"
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name={`recurso-${r.key}`}
                      value={o.value}
                      checked={current === o.value}
                      onChange={() => set(r.key, o.value)}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </fieldset>
  );
}
