"use client";

import React from "react";
import { Info } from "lucide-react";

/** Texto exato do aviso de ponto "Em mapeamento" (RF-4.2). */
export const MAPPING_NOTICE_TEXT =
  "Ainda não temos informações oficiais de acessibilidade deste local. O que aparece abaixo vem da comunidade e pode estar incompleto ou desatualizado.";

/**
 * Aviso no topo da tela de um ponto em mapeamento. O id é o alvo do
 * aria-describedby da seção (PointDetails), então o leitor de tela o anuncia
 * logo depois do título. bg-brand-light literal: no alto contraste vira
 * amarelo com texto preto (regra existente em globals.css).
 */
export default function MappingNotice() {
  return (
    <div id="aviso-mapeamento" role="note" className="bg-brand-light border border-brand rounded-3xl p-5 flex items-start gap-3">
      <Info className="w-6 h-6 text-brand flex-shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-base font-semibold text-text-main leading-relaxed">{MAPPING_NOTICE_TEXT}</p>
    </div>
  );
}
