"use client";

import React, { useEffect, useState } from "react";
import { Loader2, MessageSquareText, RefreshCw, EyeOff } from "lucide-react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { fetchRecentRelatos, hideRelato, type AdminRelatoRow } from "@/services/relatosAdminService";
import { communityResourceLabel } from "@/lib/communityResources";

const PAGE_SIZE = 30;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function recursosTexto(r: AdminRelatoRow["recursos"]): string | null {
  if (!r) return null;
  const partes = Object.entries(r)
    .filter(([, v]) => v === "tem" || v === "nao_tem")
    .map(([k, v]) => `${communityResourceLabel(k)}: ${v === "tem" ? "tem" : "não tem"}`);
  return partes.length > 0 ? partes.join("; ") : null;
}

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { message?: string })?.message ?? "";
  if (msg.includes("forbidden")) return "Sem permissão para esta ação.";
  if (msg.includes("relato_nao_encontrado")) return "Relato não encontrado.";
  return fallback;
}

/**
 * Admin — /admin/relatos. Relatos recentes da comunidade (inclusive os
 * ocultos, marcados em texto). "Ocultar" é exclusão lógica: o relato some do
 * app e deixa de contar para a condição e para o consenso, mas continua
 * guardado. Todo texto vindo do banco é renderizado como texto puro (JSX).
 */
export default function AdminRelatosPage() {
  const [items, setItems] = useState<AdminRelatoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [confirmItem, setConfirmItem] = useState<AdminRelatoRow | null>(null);
  const [hiding, setHiding] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchRecentRelatos({ limit: PAGE_SIZE });
      setItems(data);
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível carregar os relatos."));
    } finally {
      setLoading(false);
    }
  };

  // Carga inicial sem setState síncrono no efeito (loading já começa true).
  useEffect(() => {
    let cancelled = false;
    fetchRecentRelatos({ limit: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setHasMore(data.length === PAGE_SIZE);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Não foi possível carregar os relatos."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setError("");
    try {
      const data = await fetchRecentRelatos({ before: last.criado_em, limit: PAGE_SIZE });
      setItems((prev) => [...prev, ...data.filter((d) => !prev.some((p) => p.id === d.id))]);
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível carregar mais relatos."));
    } finally {
      setLoadingMore(false);
    }
  };

  const confirmHide = async () => {
    if (!confirmItem) return;
    setHiding(true);
    setError("");
    try {
      await hideRelato(confirmItem.id);
      const now = new Date().toISOString();
      setItems((prev) => prev.map((i) => (i.id === confirmItem.id ? { ...i, oculto: true, ocultado_em: now } : i)));
      setConfirmItem(null);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível ocultar o relato."));
      setConfirmItem(null);
    } finally {
      setHiding(false);
    }
  };

  return (
    <main className="w-full min-h-full bg-bg-app py-8 px-4 sm:px-6 flex flex-col items-center">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-black text-text-main flex items-center gap-2.5">
              <MessageSquareText className="w-6 h-6 text-brand" aria-hidden="true" />
              Relatos recentes
            </h1>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 rounded-full bg-white border border-gray-200 px-4 py-2.5 text-sm font-bold text-text-secondary hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Atualizar
            </button>
          </div>
          <p className="text-sm text-text-secondary font-medium mt-1.5 leading-relaxed">
            Relatos de condição enviados pela comunidade, inclusive sem conta. Ocultar tira o relato do app sem apagá-lo.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm font-bold text-accent-text">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-brand animate-spin" aria-label="Carregando" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-secondary font-medium">Nenhum relato ainda.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {items.map((item) => {
                const nomePonto = item.pontos?.nome ?? "Ponto removido";
                const tipoPonto = item.pontos?.status === "em_mapeamento" ? "Em mapeamento" : "Oficial";
                const recursos = recursosTexto(item.recursos);
                return (
                  <li
                    key={item.id}
                    className="bg-white rounded-3xl p-5 border border-gray-200 flex items-start justify-between gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-text-main">
                        {nomePonto} · {tipoPonto}
                      </p>
                      <p className="mt-1 text-xs text-text-secondary font-semibold">
                        {formatDate(item.criado_em)} · {item.tipo === "problema" ? "Problema" : "Está tudo bem"}
                      </p>
                      {recursos && <p className="mt-1 text-sm text-text-secondary font-semibold">Marcou: {recursos}</p>}
                      {item.texto && (
                        <p className="mt-1.5 text-sm text-text-main font-semibold leading-relaxed break-words">{item.texto}</p>
                      )}
                      {item.oculto && (
                        <p className="mt-1.5 text-xs font-bold text-text-secondary">
                          Oculto em {item.ocultado_em ? formatDayMonth(item.ocultado_em) : "-"}
                        </p>
                      )}
                    </div>
                    {!item.oculto && (
                      <button
                        type="button"
                        onClick={() => setConfirmItem(item)}
                        className="flex items-center gap-1.5 rounded-full bg-gray-100 text-text-main px-4 py-2.5 text-sm font-bold hover:bg-gray-200 flex-shrink-0"
                        aria-label={`Ocultar relato de ${nomePonto} de ${formatDate(item.criado_em)}`}
                      >
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                        Ocultar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="self-center flex items-center gap-2 rounded-full bg-white border border-gray-200 px-5 py-2.5 text-sm font-bold text-text-main hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Carregar mais
              </button>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmItem !== null}
        title="Ocultar relato"
        message="O relato deixa de aparecer no app e não conta mais para a condição nem para o consenso. Ele continua guardado."
        confirmLabel="Ocultar"
        loading={hiding}
        onConfirm={confirmHide}
        onCancel={() => setConfirmItem(null)}
      />
    </main>
  );
}
