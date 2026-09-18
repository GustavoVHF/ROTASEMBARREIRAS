"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { PONTO_IMAGE_ACCEPT, PONTO_IMAGE_MAX_BYTES } from "@/services/pointsService";

interface ImageUploadFieldProps {
  /** Unique id for the hidden file input (create card + modal can coexist). */
  inputId: string;
  /** Folder slug derived from the point name — shown as a read-only hint. */
  folder: string;
  /** Files chosen but not uploaded yet (create flow uploads on submit). */
  pendingFiles: File[];
  onPendingChange: (files: File[]) => void;
  /** Images already in Storage (edit flow). */
  uploadedUrls?: string[];
  onRemoveUploaded?: (url: string) => void;
  removingUrl?: string | null;
  /** True while the parent is uploading pendingFiles. */
  uploading?: boolean;
  error?: string;
}

/**
 * Single image field for the whole cadastro: pick (or drop) files and that's
 * it. No cover-image URL, no gallery URLs, no folder name to type — the
 * folder is derived from the point name and created by the upload itself,
 * and the FIRST image becomes imagem_capa automatically.
 */
export default function ImageUploadField({
  inputId,
  folder,
  pendingFiles,
  onPendingChange,
  uploadedUrls = [],
  onRemoveUploaded,
  removingUrl = null,
  uploading = false,
  error,
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");

  const previews = useMemo(
    () => pendingFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [pendingFiles]
  );

  useEffect(() => {
    return () => previews.forEach((p) => URL.revokeObjectURL(p.url));
  }, [previews]);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(incoming)) {
      if (!file.type.startsWith("image/")) {
        rejected.push(`${file.name} (não é imagem)`);
      } else if (file.size > PONTO_IMAGE_MAX_BYTES) {
        rejected.push(`${file.name} (maior que 5 MB)`);
      } else {
        accepted.push(file);
      }
    }
    setLocalError(rejected.length > 0 ? `Ignorado: ${rejected.join(", ")}` : "");
    if (accepted.length > 0) onPendingChange([...pendingFiles, ...accepted]);
  };

  const removePending = (index: number) => {
    onPendingChange(pendingFiles.filter((_, i) => i !== index));
  };

  const totalCount = uploadedUrls.length + pendingFiles.length;

  return (
    <div>
      <label htmlFor={inputId} className="text-xs font-black uppercase tracking-wider text-text-secondary">
        Imagens do local
      </label>
      <p className="mt-1.5 text-xs text-text-secondary font-medium leading-relaxed">
        A primeira imagem vira a capa. A pasta no Storage é criada sozinha
        {folder ? (
          <>
            {" "}
            como <span className="font-bold text-text-main">pontos-imagens/{folder}</span>.
          </>
        ) : (
          " a partir do nome do local."
        )}
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`mt-3 rounded-2xl border border-dashed p-4 transition-colors ${
          dragging ? "border-brand bg-brand-light/50" : "border-gray-300 bg-white"
        }`}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={PONTO_IMAGE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-gray-100 hover:bg-gray-200 disabled:opacity-50 px-4 py-3 text-sm font-bold text-text-main transition-colors"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
          {uploading ? "Enviando imagens..." : totalCount > 0 ? "Adicionar mais imagens" : "Escolher imagens"}
        </button>

        {totalCount > 0 && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {uploadedUrls.map((url, index) => (
              <figure key={url} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Imagem ${index + 1}`} className="w-full h-full object-cover" />
                {index === 0 && uploadedUrls.length > 0 && (
                  <figcaption className="absolute left-0 right-0 bottom-0 bg-black/55 text-white text-[10px] font-bold text-center py-0.5">
                    Capa
                  </figcaption>
                )}
                {onRemoveUploaded && (
                  <button
                    type="button"
                    onClick={() => onRemoveUploaded(url)}
                    disabled={removingUrl === url}
                    aria-label={`Remover imagem ${index + 1}`}
                    className="absolute top-1 right-1 w-7 h-7 rounded-full bg-white/90 text-text-secondary hover:text-brand flex items-center justify-center disabled:opacity-50"
                  >
                    {removingUrl === url ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </figure>
            ))}

            {previews.map((preview, index) => (
              <figure
                key={`${preview.file.name}-${index}`}
                className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 ring-1 ring-brand/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.url} alt={preview.file.name} className="w-full h-full object-cover" />
                {uploadedUrls.length === 0 && index === 0 && (
                  <figcaption className="absolute left-0 right-0 bottom-0 bg-black/55 text-white text-[10px] font-bold text-center py-0.5">
                    Capa
                  </figcaption>
                )}
                <button
                  type="button"
                  onClick={() => removePending(index)}
                  disabled={uploading}
                  aria-label={`Remover ${preview.file.name}`}
                  className="absolute top-1 right-1 w-7 h-7 rounded-full bg-white/90 text-text-secondary hover:text-brand flex items-center justify-center disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </figure>
            ))}
          </div>
        )}
      </div>

      {(localError || error) && (
        <p className="mt-2 text-xs font-bold text-brand">{localError || error}</p>
      )}
    </div>
  );
}
