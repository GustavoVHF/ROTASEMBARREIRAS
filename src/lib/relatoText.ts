/**
 * Regras do texto livre dos relatos. Espelha o trigger
 * public.relatos_validar_texto (supabase/migrations_osm_03_relatos_comunidade.sql):
 * no máximo 280 caracteres e sem links. O texto é sempre exibido como texto
 * puro (JSX escapa), nunca como HTML.
 */
export const RELATO_MAX_CHARS = 280;

/** Equivalente à regex SQL (\m/\M viram \b). */
export const RELATO_LINK_REGEX =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|br|io|me|info|biz|xyz|app|site|online|ly|gl|co|link|tk|ru)\b)/i;

export const RELATO_TEXT_TOO_LONG = `O texto pode ter no máximo ${RELATO_MAX_CHARS} caracteres.`;
export const RELATO_TEXT_HAS_LINK = "Remova links ou endereços de sites do texto para enviar.";

/** Devolve a mensagem de erro, ou null se o texto puder ser enviado. */
export function validateRelatoText(texto: string | null | undefined): string | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  // Conta caracteres como o Postgres (char_length), não unidades UTF-16.
  if (Array.from(t).length > RELATO_MAX_CHARS) return RELATO_TEXT_TOO_LONG;
  if (RELATO_LINK_REGEX.test(t)) return RELATO_TEXT_HAS_LINK;
  return null;
}
