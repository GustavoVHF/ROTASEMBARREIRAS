"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AccessibilityDetail, AccessibilityState } from "@/types/database";

/** The 4 summary flags (plain booleans) shown as chips on the point screen. */
export interface AccessibilityFlags {
  acessibilidade_rampa: boolean;
  acessibilidade_audio: boolean;
  acessibilidade_braille: boolean;
  acessibilidade_libras: boolean;
  acessibilidade_atendimento: boolean;
}

const MAIN_FLAGS: Array<{ key: keyof AccessibilityFlags; label: string; hint: string }> = [
  { key: "acessibilidade_rampa", label: "Rampas / cadeirante", hint: "Acesso sem escadas, rampa ou elevador" },
  { key: "acessibilidade_audio", label: "Áudio guia", hint: "Narração do conteúdo do local" },
  { key: "acessibilidade_braille", label: "Braille", hint: "Placas e materiais em braille" },
  { key: "acessibilidade_libras", label: "Libras", hint: "Vídeo ou intérprete de Libras" },
  {
    key: "acessibilidade_atendimento",
    label: "Atendimento",
    hint: "Equipe treinada e atendimento prioritário para PCD",
  },
];

/** Same 3 states the app renders in the point detail bullet list. */
const STATES: Array<{ value: AccessibilityState; label: string }> = [
  { value: "tem", label: "Tem" },
  { value: "nao_tem", label: "Não tem" },
  { value: "nao_verificado", label: "Não informado" },
];

/** Common bullets, offered as a datalist so typing is optional. */
const SUGGESTED_DETAILS = [
  "Banheiro adaptado",
  "Vaga exclusiva para PCD",
  "Piso tátil",
  "Elevador",
  "Corrimão nas escadas",
  "Atendimento prioritário",
  "Entrada sem degraus",
  "Cadeira de rodas disponível",
  "Estacionamento próximo",
  "Sinalização visual",
];

interface AccessibilityEditorProps {
  /** Namespace for the datalist id (create card + edit modal can coexist). */
  idPrefix: string;
  flags: AccessibilityFlags;
  onFlagChange: (key: keyof AccessibilityFlags, value: boolean) => void;
  details: AccessibilityDetail[];
  onDetailsChange: (details: AccessibilityDetail[]) => void;
}

/**
 * Full accessibility editor: the 4 summary flags AND the bullet list that
 * renders under the accessibility card in the app, each bullet carrying its
 * own 3-state confirmation (tem / nao_tem / nao_verificado — see
 * supabase/migrations_acessibilidade_estados.sql). Before this, bullets could
 * only be edited by hand in the Supabase Table Editor.
 */
export default function AccessibilityEditor({
  idPrefix,
  flags,
  onFlagChange,
  details,
  onDetailsChange,
}: AccessibilityEditorProps) {
  const datalistId = `${idPrefix}-detalhes-sugeridos`;

  const addDetail = () => {
    onDetailsChange([...details, { texto: "", estado: "nao_verificado" }]);
  };

  const updateDetail = (index: number, patch: Partial<AccessibilityDetail>) => {
    onDetailsChange(details.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const removeDetail = (index: number) => {
    onDetailsChange(details.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-xs font-black uppercase tracking-wider text-text-secondary">Recursos principais</h3>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {MAIN_FLAGS.map(({ key, label, hint }) => (
            <label
              key={key}
              className={`flex items-start gap-3 rounded-2xl border px-4 py-3 cursor-pointer transition-colors ${
                flags[key] ? "border-brand bg-brand-light/60" : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
            >
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={(e) => onFlagChange(key, e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-brand flex-shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-text-main leading-tight">{label}</span>
                <span className="block text-xs text-text-secondary font-medium mt-0.5 leading-snug">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-text-secondary">
            Itens detalhados {details.length > 0 && `(${details.length})`}
          </h3>
          <button
            type="button"
            onClick={addDetail}
            className="flex items-center gap-1.5 text-xs font-black text-brand hover:text-brand-dark transition-colors"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            Adicionar item
          </button>
        </div>
        <p className="mt-1.5 text-xs text-text-secondary font-medium leading-relaxed">
          Lista que aparece abaixo dos recursos na tela do ponto. Cada item guarda o próprio estado.
        </p>

        <datalist id={datalistId}>
          {SUGGESTED_DETAILS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        {details.length === 0 ? (
          <button
            type="button"
            onClick={addDetail}
            className="mt-3 w-full rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-5 text-sm font-bold text-text-secondary hover:border-brand hover:text-brand transition-colors"
          >
            Nenhum item ainda. Adicionar o primeiro
          </button>
        ) : (
          <div className="mt-3 flex flex-col gap-2.5">
            {details.map((detail, index) => (
              <div key={index} className="rounded-2xl border border-gray-200 bg-white p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={detail.texto}
                    list={datalistId}
                    onChange={(e) => updateDetail(index, { texto: e.target.value })}
                    placeholder="Ex: Banheiro adaptado"
                    className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-text-main focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => removeDetail(index)}
                    aria-label={`Remover item ${index + 1}`}
                    className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 text-text-secondary hover:bg-brand-light hover:text-brand flex items-center justify-center transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`Estado de ${detail.texto || `item ${index + 1}`}`}>
                  {STATES.map(({ value, label }) => {
                    const active = detail.estado === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => updateDetail(index, { estado: value })}
                        className={`rounded-xl px-2 py-2 text-xs font-bold transition-colors ${
                          active
                            ? "bg-brand text-white"
                            : "bg-gray-100 text-text-secondary hover:bg-gray-200"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
