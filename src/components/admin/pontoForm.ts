import type { AccessibilityDetail } from "@/types/database";
import type { TouristPoint } from "@/types/point";

/**
 * Single source of truth for the cadastro/edição form shape, shared by the
 * "novo ponto" card and the edit modal so both screens always expose exactly
 * the same fields (the old panel edited only 4 text fields inline).
 *
 * Deliberately NOT in here: imagem_capa, galeria_imagens, pasta_imagens and
 * qr_code_value. All four are derived automatically (folder + QR from the
 * name slug, cover/gallery from the uploaded images), so the admin never
 * types a URL or a slug.
 */
export interface PontoFormValues {
  nome: string;
  categoria: string;
  cidade: string;
  endereco: string;
  latitude: number | null;
  longitude: number | null;
  descricao_curta: string;
  descricao_longa: string;
  acessibilidade_rampa: boolean;
  acessibilidade_audio: boolean;
  acessibilidade_braille: boolean;
  acessibilidade_libras: boolean;
  acessibilidade_detalhes: AccessibilityDetail[];
}

export const EMPTY_PONTO_FORM: PontoFormValues = {
  nome: "",
  categoria: "",
  cidade: "",
  endereco: "",
  latitude: null,
  longitude: null,
  descricao_curta: "",
  descricao_longa: "",
  acessibilidade_rampa: false,
  acessibilidade_audio: false,
  acessibilidade_braille: false,
  acessibilidade_libras: false,
  acessibilidade_detalhes: [],
};

export function pointToFormValues(point: TouristPoint): PontoFormValues {
  return {
    nome: point.name,
    categoria: point.category,
    cidade: point.city,
    endereco: point.address,
    latitude: point.coords.lat,
    longitude: point.coords.lng,
    descricao_curta: point.description,
    descricao_longa: point.history,
    acessibilidade_rampa: point.accessibility.wheelchair,
    acessibilidade_audio: point.accessibility.audio,
    acessibilidade_braille: point.accessibility.braille,
    acessibilidade_libras: point.accessibility.libras,
    acessibilidade_detalhes: point.accessibility.details.map((d) => ({ ...d })),
  };
}

/** Required: nome, categoria, cidade and a geocoded address (lat/lng). */
export function pontoFormErrors(values: PontoFormValues): string[] {
  const errors: string[] = [];
  if (!values.nome.trim()) errors.push("Informe o nome do local.");
  if (!values.categoria.trim()) errors.push("Informe a categoria.");
  if (!values.cidade.trim()) errors.push("Informe a cidade.");
  if (values.latitude === null || values.longitude === null) {
    errors.push("Escolha o endereço na lista de resultados para capturar as coordenadas.");
  }
  return errors;
}

/** Drops empty bullets so the jsonb column never stores blank items. */
export function cleanDetails(details: AccessibilityDetail[]): AccessibilityDetail[] {
  return details
    .map((d) => ({ texto: d.texto.trim(), estado: d.estado }))
    .filter((d) => d.texto.length > 0);
}
