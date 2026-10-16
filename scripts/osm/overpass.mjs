// ============================================================
// Cliente da Overpass API com retentativa (uso justo da API pública).
// Uma consulta por sincronização; em caso de limite/erro temporário, espera
// e tenta de novo (no máximo 3 retentativas). Só roda no servidor (Node).
// ============================================================

import { OVERPASS_ENDPOINT } from "./config.mjs";

export const BACKOFF_SEGUNDOS = [30, 60, 120];
export const MAX_RETENTATIVAS = 3;
const RETRY_AFTER_MAX = 300;
const STATUS_RETENTAVEIS = new Set([429, 502, 503, 504]);
const REMARK_RETENTAVEL = /runtime error|timed out|out of memory/i;

export class OverpassError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "OverpassError";
    this.status = status;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After em segundos ou data HTTP; limitado a 300 s. null se ausente/inválido. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    return Math.min(Number(s), RETRY_AFTER_MAX);
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.min(Math.max(0, Math.ceil((t - now) / 1000)), RETRY_AFTER_MAX);
}

/**
 * POST da consulta. Devolve o JSON da resposta.
 * opts: { userAgent, endpoint, fetchImpl, sleep, timeoutMs, log }
 */
export async function fetchOverpass(query, opts = {}) {
  const {
    userAgent,
    endpoint = OVERPASS_ENDPOINT,
    fetchImpl = fetch,
    sleep = defaultSleep,
    timeoutMs = 210_000,
    log = (msg) => console.log(msg),
  } = opts;

  let ultimoStatus = "sem resposta";

  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS; tentativa += 1) {
    let retryAfter = null;
    let motivo;

    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent,
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        const json = await res.json();
        if (typeof json?.remark === "string" && REMARK_RETENTAVEL.test(json.remark)) {
          ultimoStatus = `200 (remark: ${json.remark.slice(0, 120)})`;
          motivo = "remark";
        } else {
          return json;
        }
      } else if (STATUS_RETENTAVEIS.has(res.status)) {
        ultimoStatus = String(res.status);
        motivo = String(res.status);
        retryAfter = parseRetryAfter(res.headers?.get?.("retry-after"));
      } else {
        let corpo = "";
        try {
          corpo = (await res.text()).slice(0, 300);
        } catch {
          corpo = "";
        }
        throw new OverpassError(`Overpass respondeu ${res.status}: ${corpo}`, res.status);
      }
    } catch (err) {
      if (err instanceof OverpassError) throw err;
      const nome = err?.name ?? "";
      ultimoStatus = nome === "TimeoutError" || nome === "AbortError" ? "timeout" : "erro de rede";
      motivo = ultimoStatus;
    }

    if (tentativa === MAX_RETENTATIVAS) break;

    const espera = retryAfter ?? BACKOFF_SEGUNDOS[tentativa];
    log(`Overpass ${motivo}, nova tentativa em ${espera} s (${tentativa + 1}/${MAX_RETENTATIVAS})`);
    await sleep(espera * 1000);
  }

  throw new OverpassError(`Overpass indisponível após ${MAX_RETENTATIVAS} retentativas (último status: ${ultimoStatus}).`, ultimoStatus);
}
