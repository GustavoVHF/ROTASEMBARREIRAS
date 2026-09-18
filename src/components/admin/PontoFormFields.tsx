"use client";

import React from "react";
import AddressAutocomplete from "./AddressAutocomplete";
import AccessibilityEditor, { AccessibilityFlags } from "./AccessibilityEditor";
import ImageUploadField from "./ImageUploadField";
import type { PontoFormValues } from "./pontoForm";
import { slugifyPontoFolder } from "@/services/pointsService";

const INPUT_CLASS =
  "w-full mt-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-text-main focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand";
const LABEL_CLASS = "text-xs font-black uppercase tracking-wider text-text-secondary";

interface PontoFormFieldsProps {
  values: PontoFormValues;
  onChange: (patch: Partial<PontoFormValues>) => void;
  /** Namespace for input/datalist ids — the create card and the edit modal can
   * be mounted at the same time, so ids must not collide. */
  idPrefix: string;
  /** Existing categorias/cidades, offered as datalist options. */
  categorias: string[];
  cidades: string[];
  /** Image field wiring. */
  pendingFiles: File[];
  onPendingFilesChange: (files: File[]) => void;
  uploadedUrls?: string[];
  onRemoveUploaded?: (url: string) => void;
  removingUrl?: string | null;
  uploading?: boolean;
  imageError?: string;
  /** Existing folder slug when editing (keeps images in their original folder). */
  folderOverride?: string | null;
}

/**
 * Every field of a ponto, in one place. Rendered both inside the "novo ponto"
 * card and inside the edit modal — same markup, same validation, no drift.
 */
export default function PontoFormFields({
  values,
  onChange,
  idPrefix,
  categorias,
  cidades,
  pendingFiles,
  onPendingFilesChange,
  uploadedUrls,
  onRemoveUploaded,
  removingUrl,
  uploading,
  imageError,
  folderOverride,
}: PontoFormFieldsProps) {
  const folder = folderOverride || slugifyPontoFolder(values.nome);
  const id = (suffix: string) => `${idPrefix}-${suffix}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor={id("nome")} className={LABEL_CLASS}>
          Nome do local *
        </label>
        <input
          id={id("nome")}
          type="text"
          value={values.nome}
          onChange={(e) => onChange({ nome: e.target.value })}
          placeholder="Ex: Pico da Ibituruna"
          className={INPUT_CLASS}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={id("categoria")} className={LABEL_CLASS}>
            Categoria *
          </label>
          <input
            id={id("categoria")}
            type="text"
            list={id("categorias-list")}
            value={values.categoria}
            onChange={(e) => onChange({ categoria: e.target.value })}
            placeholder="Ex: Patrimônio"
            className={INPUT_CLASS}
          />
          <datalist id={id("categorias-list")}>
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor={id("cidade")} className={LABEL_CLASS}>
            Cidade *
          </label>
          <input
            id={id("cidade")}
            type="text"
            list={id("cidades-list")}
            value={values.cidade}
            onChange={(e) => onChange({ cidade: e.target.value })}
            placeholder="Ex: Governador Valadares"
            className={INPUT_CLASS}
          />
          <datalist id={id("cidades-list")}>
            {cidades.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <AddressAutocomplete
        value={values.endereco}
        coords={
          values.latitude !== null && values.longitude !== null
            ? { lat: values.latitude, lng: values.longitude }
            : null
        }
        onTextChange={(text) => onChange({ endereco: text, latitude: null, longitude: null })}
        onSelect={(result) =>
          onChange({ endereco: result.label, latitude: result.lat, longitude: result.lng })
        }
        required
      />

      <div>
        <label htmlFor={id("desc-curta")} className={LABEL_CLASS}>
          Descrição curta
        </label>
        <textarea
          id={id("desc-curta")}
          value={values.descricao_curta}
          onChange={(e) => onChange({ descricao_curta: e.target.value })}
          rows={2}
          placeholder="Aparece no card do mapa e na busca"
          className={`${INPUT_CLASS} resize-none`}
        />
      </div>

      <div>
        <label htmlFor={id("desc-longa")} className={LABEL_CLASS}>
          Descrição longa
        </label>
        <textarea
          id={id("desc-longa")}
          value={values.descricao_longa}
          onChange={(e) => onChange({ descricao_longa: e.target.value })}
          rows={5}
          placeholder="Texto da seção História, na tela do ponto"
          className={`${INPUT_CLASS} resize-none`}
        />
      </div>

      <ImageUploadField
        inputId={id("imagens")}
        folder={folder}
        pendingFiles={pendingFiles}
        onPendingChange={onPendingFilesChange}
        uploadedUrls={uploadedUrls}
        onRemoveUploaded={onRemoveUploaded}
        removingUrl={removingUrl}
        uploading={uploading}
        error={imageError}
      />

      <div className="pt-4 border-t border-gray-100">
        <AccessibilityEditor
          idPrefix={idPrefix}
          flags={{
            acessibilidade_rampa: values.acessibilidade_rampa,
            acessibilidade_audio: values.acessibilidade_audio,
            acessibilidade_braille: values.acessibilidade_braille,
            acessibilidade_libras: values.acessibilidade_libras,
            acessibilidade_atendimento: values.acessibilidade_atendimento,
          }}
          onFlagChange={(key: keyof AccessibilityFlags, value: boolean) => onChange({ [key]: value })}
          details={values.acessibilidade_detalhes}
          onDetailsChange={(details) => onChange({ acessibilidade_detalhes: details })}
        />
      </div>
    </div>
  );
}
