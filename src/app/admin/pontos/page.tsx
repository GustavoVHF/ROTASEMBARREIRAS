"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Check,
  Loader2,
  MapPinned,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import AdminModal from "@/components/admin/AdminModal";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import PontoFormFields from "@/components/admin/PontoFormFields";
import {
  EMPTY_PONTO_FORM,
  PontoFormValues,
  cleanDetails,
  pointToFormValues,
  pontoFormErrors,
} from "@/components/admin/pontoForm";
import {
  clearPointsCache,
  createPonto,
  deletePontoImagem,
  deletePonto,
  fetchAllPontosAdmin,
  slugifyPontoFolder,
  updatePonto,
  uploadPontoImagens,
  NewPontoInput,
} from "@/services/pointsService";
import { checkExistingPlace, fetchPontoById } from "@/services/communityPointsService";
import type { TouristPoint } from "@/types/point";
import type { ExistingPlaceMatch, PointStatus } from "@/types/database";

/**
 * Admin — /admin/pontos.
 *
 * Layout: two columns on xl+ ("novo ponto" card beside the listing), stacked
 * on smaller screens. The page itself never owns the scroll — the admin shell
 * (src/app/admin/layout.tsx) provides a single scroll container, which is what
 * fixes the old "can't scroll to the bottom of the form" bug caused by the
 * app-wide `html { overflow: hidden }` in globals.css.
 *
 * Cadastro is intentionally short: folder slug, cover image, gallery and QR
 * value are all derived (name slug + uploaded images), so there are no URL or
 * slug fields to fill. Editing happens in a modal with the exact same fields.
 */

type Feedback = { type: "success" | "error"; text: string } | null;

interface EditState {
  /** "promover": ponto em mapeamento vira oficial no MESMO registro (UPDATE por id). */
  mode: "editar" | "promover";
  point: TouristPoint;
  values: PontoFormValues;
  /** Images already in Storage for this point (capa first). */
  images: string[];
  files: File[];
}

/** pontos.qr_code_value is UNIQUE — suffix until free. */
function buildQrValue(slug: string, points: TouristPoint[], excludeId?: string): string {
  const taken = new Set(
    points.filter((p) => p.id !== excludeId).map((p) => p.qrCodeValue).filter((v): v is string => !!v)
  );
  const base = `rota-${slug || "ponto"}`;
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

/** Corrida residual na unicidade do QR vira mensagem legível. */
function saveErrorMessage(err: unknown, fallback: string): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === "23505" && /qr_code_value/i.test(e.message ?? "")) {
    return "Já existe um QR com esse nome; ajuste o nome e tente de novo.";
  }
  return err instanceof Error ? err.message : e?.message || fallback;
}

function pointImages(point: TouristPoint): string[] {
  return [...new Set([point.image, ...point.gallery].filter((url): url is string => !!url))];
}

export default function AdminPontosPage() {
  const [points, setPoints] = useState<TouristPoint[]>([]);
  const [listStatus, setListStatus] = useState<PointStatus>("oficial");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  // --- create ---
  const [form, setForm] = useState<PontoFormValues>(EMPTY_PONTO_FORM);
  const [formFiles, setFormFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  // Pré-checagem: já existe um local parecido no mesmo lugar?
  const [createConflict, setCreateConflict] = useState<ExistingPlaceMatch | null>(null);

  // --- edit ---
  const [edit, setEdit] = useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [removingUrl, setRemovingUrl] = useState<string | null>(null);

  // --- delete ---
  const [deleteTarget, setDeleteTarget] = useState<TouristPoint | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadPoints = async (status: PointStatus = listStatus) => {
    setListLoading(true);
    setListError("");
    try {
      setPoints(await fetchAllPontosAdmin(status));
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Não foi possível carregar os pontos.");
    } finally {
      setListLoading(false);
    }
  };

  // Initial fetch. Written without the setListLoading(true) prelude of
  // loadPoints() so no state is set synchronously inside the effect
  // (react-hooks/set-state-in-effect) — listLoading already starts true.
  useEffect(() => {
    let cancelled = false;
    fetchAllPontosAdmin()
      .then((data) => {
        if (!cancelled) setPoints(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setListError(err instanceof Error ? err.message : "Não foi possível carregar os pontos.");
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-dismiss the inline banner (no native alerts anywhere in this panel).
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const categorias = useMemo(
    () => [...new Set(points.map((p) => p.category).filter(Boolean))].sort(),
    [points]
  );
  const cidades = useMemo(() => [...new Set(points.map((p) => p.city).filter(Boolean))].sort(), [points]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return points;
    return points.filter((p) =>
      [p.name, p.city, p.category].some((field) => field?.toLowerCase().includes(q))
    );
  }, [points, query]);

  const updateForm = (patch: Partial<PontoFormValues>) => setForm((prev) => ({ ...prev, ...patch }));

  const switchTab = (status: PointStatus) => {
    if (status === listStatus) return;
    setListStatus(status);
    setQuery("");
    void loadPoints(status);
  };

  // ---------------------------------------------------------------- create
  const handleCreate = async (e?: React.FormEvent, bypassConflito = false) => {
    e?.preventDefault();
    const errors = pontoFormErrors(form);
    if (errors.length > 0) {
      setCreateError(errors[0]);
      return;
    }

    setCreating(true);
    setCreateError("");

    // Antes de enviar qualquer coisa: já existe um local parecido aqui
    // (oficial ou em mapeamento)? Falha de rede/RPC não bloqueia o cadastro.
    if (!bypassConflito) {
      try {
        const matches = await checkExistingPlace(form.nome, form.latitude as number, form.longitude as number);
        if (matches.length > 0) {
          setCreateConflict(matches[0]);
          setCreating(false);
          return;
        }
      } catch (err) {
        if (process.env.NODE_ENV !== "production") console.warn("[admin] pré-checagem falhou", err);
      }
    }
    setCreateConflict(null);

    const folder = slugifyPontoFolder(form.nome) || `ponto-${Date.now()}`;
    let uploaded: string[] = [];

    try {
      // QR é único entre os oficiais; na aba "Em mapeamento" a lista não os tem.
      const officials = listStatus === "oficial" ? points : await fetchAllPontosAdmin("oficial");
      uploaded = await uploadPontoImagens(folder, formFiles);

      const input: NewPontoInput = {
        nome: form.nome.trim(),
        categoria: form.categoria.trim(),
        cidade: form.cidade.trim(),
        latitude: form.latitude as number,
        longitude: form.longitude as number,
        endereco: form.endereco.trim() || null,
        descricao_curta: form.descricao_curta.trim() || null,
        descricao_longa: form.descricao_longa.trim() || null,
        imagem_capa: uploaded[0] ?? null,
        galeria_imagens: uploaded,
        acessibilidade_rampa: form.acessibilidade_rampa,
        acessibilidade_audio: form.acessibilidade_audio,
        acessibilidade_braille: form.acessibilidade_braille,
        acessibilidade_libras: form.acessibilidade_libras,
        acessibilidade_atendimento: form.acessibilidade_atendimento,
        acessibilidade_detalhes: cleanDetails(form.acessibilidade_detalhes),
        qr_code_value: buildQrValue(folder, officials),
        pasta_imagens: folder,
      };

      await createPonto(input);
      setForm(EMPTY_PONTO_FORM);
      setFormFiles([]);
      setFeedback({ type: "success", text: `"${input.nome}" cadastrado. Formulário limpo para o próximo.` });
      clearPointsCache();
      await loadPoints();
    } catch (err) {
      // Row insert failed after the images went up: clean the orphans so the
      // bucket doesn't fill with images nobody references.
      if (uploaded.length > 0) {
        await Promise.allSettled(uploaded.map((url) => deletePontoImagem(url)));
      }
      setCreateError(saveErrorMessage(err, "Não foi possível cadastrar o ponto."));
    } finally {
      setCreating(false);
    }
  };

  // ------------------------------------------------------------------ edit
  const openEdit = (point: TouristPoint) => {
    setEditError("");
    setEdit({ mode: "editar", point, values: pointToFormValues(point), images: pointImages(point), files: [] });
  };

  /** Promover a oficial: mesmo formulário, pré-preenchido; salva no MESMO registro. */
  const openPromote = (point: TouristPoint) => {
    setEditError("");
    setEdit({ mode: "promover", point, values: pointToFormValues(point), images: pointImages(point), files: [] });
  };

  // Painel de conflito do cadastro: abrir o ponto já existente.
  const openConflictPoint = async (match: ExistingPlaceMatch) => {
    setCreateError("");
    try {
      const point = await fetchPontoById(match.ponto_id);
      if (!point) {
        setCreateError("Não foi possível abrir o ponto existente.");
        return;
      }
      setCreateConflict(null);
      if (match.status === "em_mapeamento") openPromote(point);
      else openEdit(point);
    } catch {
      setCreateError("Não foi possível abrir o ponto existente.");
    }
  };

  const closeEdit = () => {
    if (savingEdit) return;
    setEdit(null);
    setEditError("");
  };

  const updateEditValues = (patch: Partial<PontoFormValues>) =>
    setEdit((prev) => (prev ? { ...prev, values: { ...prev.values, ...patch } } : prev));

  const handleRemoveUploaded = async (url: string) => {
    if (!edit) return;
    setRemovingUrl(url);
    setEditError("");
    const remaining = edit.images.filter((u) => u !== url);
    try {
      await updatePonto(edit.point.id, {
        imagem_capa: remaining[0] ?? null,
        galeria_imagens: remaining,
      });
      await deletePontoImagem(url).catch(() => {
        // Row already updated; a leftover object in the bucket is harmless.
      });
      setEdit((prev) => (prev ? { ...prev, images: remaining } : prev));
      setPoints((prev) =>
        prev.map((p) =>
          p.id === edit.point.id ? { ...p, image: remaining[0] ?? "", gallery: remaining } : p
        )
      );
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Não foi possível remover a imagem.");
    } finally {
      setRemovingUrl(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!edit) return;
    const errors = pontoFormErrors(edit.values);
    if (errors.length > 0) {
      setEditError(errors[0]);
      return;
    }

    setSavingEdit(true);
    setEditError("");
    const promoting = edit.mode === "promover";
    const folder =
      edit.point.imageFolder || slugifyPontoFolder(edit.values.nome) || `ponto-${edit.point.id.slice(0, 8)}`;

    // Na promoção, o QR é calculado contra os OFICIAIS (a aba "Em mapeamento"
    // não tem os QR deles). Se não der para conferir, nada é gravado.
    let qrBase = points;
    if (promoting) {
      try {
        qrBase = await fetchAllPontosAdmin("oficial");
      } catch {
        setEditError("Não foi possível verificar os QR existentes. Tente de novo.");
        setSavingEdit(false);
        return;
      }
    }

    try {
      const newUrls = await uploadPontoImagens(folder, edit.files);
      const allImages = [...edit.images, ...newUrls];

      await updatePonto(edit.point.id, {
        nome: edit.values.nome.trim(),
        categoria: edit.values.categoria.trim(),
        cidade: edit.values.cidade.trim(),
        latitude: edit.values.latitude as number,
        longitude: edit.values.longitude as number,
        endereco: edit.values.endereco.trim() || null,
        descricao_curta: edit.values.descricao_curta.trim() || null,
        descricao_longa: edit.values.descricao_longa.trim() || null,
        imagem_capa: allImages[0] ?? null,
        galeria_imagens: allImages,
        acessibilidade_rampa: edit.values.acessibilidade_rampa,
        acessibilidade_audio: edit.values.acessibilidade_audio,
        acessibilidade_braille: edit.values.acessibilidade_braille,
        acessibilidade_libras: edit.values.acessibilidade_libras,
        acessibilidade_atendimento: edit.values.acessibilidade_atendimento,
        acessibilidade_detalhes: cleanDetails(edit.values.acessibilidade_detalhes),
        pasta_imagens: folder,
        qr_code_value: edit.point.qrCodeValue || buildQrValue(folder, qrBase, edit.point.id),
        // Um único UPDATE por id: mesmo registro, relatos e vínculo OSM mantidos.
        ...(promoting ? { status: "oficial" as const } : {}),
      });

      setEdit(null);
      setFeedback({
        type: "success",
        text: promoting
          ? `"${edit.values.nome.trim()}" promovido a oficial.`
          : `"${edit.values.nome.trim()}" atualizado.`,
      });
      clearPointsCache();
      await loadPoints();
    } catch (err) {
      setEditError(saveErrorMessage(err, "Não foi possível salvar as alterações."));
    } finally {
      setSavingEdit(false);
    }
  };

  // ---------------------------------------------------------------- delete
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePonto(deleteTarget.id);
      setPoints((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setFeedback({ type: "success", text: `"${deleteTarget.name}" excluído.` });
      setDeleteTarget(null);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Não foi possível excluir o ponto.",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mx-auto w-full max-w-[1500px] flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-text-main flex items-center gap-2.5">
            <MapPinned className="w-6 h-6 text-brand" />
            Pontos
          </h1>
          <button
            type="button"
            onClick={() => void loadPoints()}
            disabled={listLoading}
            className="flex items-center gap-2 rounded-full bg-white border border-gray-200 px-4 py-2.5 text-sm font-bold text-text-secondary hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${listLoading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>

        {feedback && (
          <div
            role="status"
            className={`rounded-2xl px-5 py-3.5 flex items-center gap-2.5 text-sm font-bold ${
              feedback.type === "success"
                ? "bg-brand-light text-brand"
                : "bg-accent-bg text-accent-text"
            }`}
          >
            {feedback.type === "success" ? (
              <Check className="w-4 h-4 stroke-[3] flex-shrink-0" />
            ) : (
              <TriangleAlert className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="min-w-0">{feedback.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-5 items-start">
          {/* ------------------------------ Cadastro ------------------------------ */}
          <section className="bg-white rounded-3xl border border-gray-100 shadow-md overflow-hidden">
            <header className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-base font-black text-text-main">Novo ponto</h2>
            </header>
            <form onSubmit={handleCreate} className="px-6 py-5 flex flex-col gap-5">
              <PontoFormFields
                idPrefix="novo-ponto"
                values={form}
                onChange={updateForm}
                categorias={categorias}
                cidades={cidades}
                pendingFiles={formFiles}
                onPendingFilesChange={setFormFiles}
                uploading={creating}
              />

              {createConflict && (
                <div role="status" className="rounded-2xl border border-gray-200 bg-white p-4 flex flex-col gap-3">
                  <p className="text-sm font-bold text-text-main">
                    Já existe um local parecido a {createConflict.distancia_m} m: {createConflict.nome} (
                    {createConflict.status === "em_mapeamento" ? "Em mapeamento" : "Oficial"})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void openConflictPoint(createConflict)}
                      className="rounded-full px-4 py-2.5 text-sm font-bold bg-brand text-white hover:bg-brand-dark"
                    >
                      {createConflict.status === "em_mapeamento" ? "Promover este ponto" : "Abrir ponto oficial"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCreate(undefined, true)}
                      className="rounded-full px-4 py-2.5 text-sm font-bold bg-gray-100 text-text-main hover:bg-gray-200"
                    >
                      Cadastrar mesmo assim
                    </button>
                  </div>
                </div>
              )}

              {createError && <p className="text-sm font-bold text-accent-text">{createError}</p>}

              <button
                type="submit"
                disabled={creating}
                className="flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white font-bold text-sm rounded-full py-3.5 transition-colors"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cadastrando...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 stroke-[3]" />
                    Cadastrar ponto
                  </>
                )}
              </button>
            </form>
          </section>

          {/* ------------------------------ Listagem ------------------------------ */}
          <section className="bg-white rounded-3xl border border-gray-100 shadow-md overflow-hidden">
            <header className="px-6 py-5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-3">
                <div className="flex gap-2" role="group" aria-label="Tipo de ponto">
                  {(["oficial", "em_mapeamento"] as const).map((s) => {
                    const active = listStatus === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={active}
                        onClick={() => switchTab(s)}
                        className={`rounded-full px-4 py-2 text-sm font-bold focus-visible:outline-3 focus-visible:outline-brand-dark ${
                          active
                            ? "bg-brand text-white border-2 border-brand"
                            : "bg-white text-text-main border-2 border-gray-200"
                        }`}
                      >
                        {s === "oficial" ? "Oficiais" : "Em mapeamento"}
                      </button>
                    );
                  })}
                </div>
                <h2 className="text-base font-black text-text-main">
                  {listStatus === "oficial" ? "Pontos cadastrados" : "Pontos em mapeamento"}{" "}
                  {!listLoading && `(${points.length})`}
                </h2>
              </div>
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por nome, cidade..."
                  aria-label="Buscar pontos cadastrados"
                  className="w-full rounded-full border border-gray-200 bg-white pl-10 pr-4 py-2.5 text-sm font-semibold text-text-main focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
              </div>
            </header>

            {listError && (
              <p className="px-6 pt-4 text-sm font-bold text-accent-text">{listError}</p>
            )}

            {listLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 text-brand animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-6 py-12 text-sm text-text-secondary font-medium text-center">
                {points.length === 0
                  ? "Nenhum ponto cadastrado ainda."
                  : "Nenhum ponto corresponde à busca."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filtered.map((point) => (
                  <li key={point.id} className="px-5 sm:px-6 py-4 flex items-center gap-4 hover:bg-gray-50/70 transition-colors">
                    <div className="w-14 h-14 rounded-2xl bg-gray-100 overflow-hidden flex-shrink-0">
                      {point.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={point.image} alt={point.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-text-secondary">
                          <MapPinned className="w-5 h-5" />
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-text-main truncate">{point.name}</p>
                      <p className="text-xs text-text-secondary font-semibold truncate mt-0.5">
                        {[point.city, point.category].filter(Boolean).join(" · ")}
                      </p>
                      <p className="text-xs text-text-secondary font-medium truncate mt-0.5">
                        {point.status === "em_mapeamento"
                          ? "Fonte: OpenStreetMap"
                          : point.description || "Sem descrição curta"}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {point.status === "em_mapeamento" ? (
                        <button
                          type="button"
                          onClick={() => openPromote(point)}
                          aria-label={`Promover ${point.name} a oficial`}
                          className="min-h-10 rounded-full bg-gray-100 text-text-main hover:bg-gray-200 flex items-center gap-1.5 px-3.5 text-sm font-bold"
                        >
                          <BadgeCheck className="w-4 h-4" aria-hidden="true" />
                          Promover a oficial
                        </button>
                      ) : (
                      <button
                        type="button"
                        onClick={() => openEdit(point)}
                        aria-label={`Editar ${point.name}`}
                        className="w-10 h-10 rounded-full bg-gray-100 text-text-secondary hover:bg-gray-200 flex items-center justify-center transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(point)}
                        aria-label={`Excluir ${point.name}`}
                        className="w-10 h-10 rounded-full bg-gray-100 text-brand hover:bg-brand-light flex items-center justify-center transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* ------------------------------- Edit modal ------------------------------- */}
      <AdminModal
        open={!!edit}
        title={edit ? (edit.mode === "promover" ? "Promover a ponto oficial" : `Editar ${edit.point.name}`) : ""}
        subtitle={
          edit?.mode === "promover"
            ? "O mesmo registro passa a ser oficial. Relatos e vínculo com o OpenStreetMap são mantidos."
            : edit?.point.qrCodeValue
              ? `QR: ${edit.point.qrCodeValue}`
              : undefined
        }
        onClose={closeEdit}
        footer={
          <>
            <button
              type="button"
              onClick={closeEdit}
              disabled={savingEdit}
              className="rounded-full px-5 py-2.5 text-sm font-bold text-text-secondary hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={savingEdit}
              className="rounded-full px-5 py-2.5 text-sm font-bold bg-brand text-white hover:bg-brand-dark disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {savingEdit && <Loader2 className="w-4 h-4 animate-spin" />}
              {edit?.mode === "promover" ? "Promover e salvar" : "Salvar alterações"}
            </button>
          </>
        }
      >
        {edit && (
          <div className="flex flex-col gap-5">
            <PontoFormFields
              idPrefix="editar-ponto"
              values={edit.values}
              onChange={updateEditValues}
              categorias={categorias}
              cidades={cidades}
              pendingFiles={edit.files}
              onPendingFilesChange={(files) =>
                setEdit((prev) => (prev ? { ...prev, files } : prev))
              }
              uploadedUrls={edit.images}
              onRemoveUploaded={handleRemoveUploaded}
              removingUrl={removingUrl}
              uploading={savingEdit}
              folderOverride={edit.point.imageFolder}
            />
            {editError && <p className="text-sm font-bold text-accent-text">{editError}</p>}
          </div>
        )}
      </AdminModal>

      {/* ------------------------------ Delete confirm ---------------------------- */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Excluir ponto"
        message={
          deleteTarget
            ? deleteTarget.status === "em_mapeamento"
              ? `"${deleteTarget.name}" será removido do mapa. Ele não voltará nas próximas sincronizações do OpenStreetMap.`
              : `"${deleteTarget.name}" será removido do mapa, das buscas e das trilhas. Esta ação não pode ser desfeita.`
            : ""
        }
        confirmLabel="Excluir"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </main>
  );
}
