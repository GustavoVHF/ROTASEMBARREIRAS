"use client";

import React from "react";
import { Check, X, HelpCircle } from "lucide-react";
import type { AccessibilityDetail } from "@/types/database";

const STATE_LABEL: Record<AccessibilityDetail["estado"], string> = {
  tem: "tem",
  nao_tem: "não tem",
  nao_verificado: "não verificado",
};

/**
 * One item in the accessibility detail bullet list, with its own 3-state
 * confirmation: "tem" (check, brand color), "nao_tem" (X, also brand
 * color — no red, keeps the app's single-accent palette), "nao_verificado"
 * (question mark badge, neutral gray so it visually reads as "unconfirmed"
 * rather than a settled answer either way).
 *
 * O estado também vai em texto para leitor de tela (o ícone é só visual).
 * `caption` = legenda discreta abaixo (ex.: "Relatado pela comunidade (3 pessoas)").
 */
export default function AccessibilityDetailItem({
  detail,
  caption,
}: {
  detail: AccessibilityDetail;
  caption?: string;
}) {
  // "tem" = confirmed, brand color. "nao_tem" and "nao_verificado" both
  // read as dull/disabled gray — "nao_tem" additionally uses an X instead
  // of a "?" to distinguish a confirmed absence from an unconfirmed one.
  const isDull = detail.estado !== "tem";
  const StatusIcon = detail.estado === "tem" ? Check : detail.estado === "nao_tem" ? X : HelpCircle;

  return (
    <li className="flex items-start gap-3.5">
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm ${
          isDull ? "bg-gray-200 text-gray-400" : "bg-brand-light text-brand"
        }`}
        aria-hidden="true"
      >
        <StatusIcon className="w-4 h-4 stroke-[3]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-base leading-relaxed font-semibold ${isDull ? "text-gray-400" : "text-text-secondary"}`}>
          {detail.texto}
          <span className="sr-only">: {STATE_LABEL[detail.estado]}</span>
        </span>
        {caption && <span className="block text-xs text-text-secondary mt-0.5">{caption}</span>}
      </span>
    </li>
  );
}
