"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import AdminModal from "./AdminModal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-UI confirmation. Replaces window.confirm() — native browser dialogs are
 * forbidden by the project's interface rules (docs/interface_rules.md) and
 * they also can't be styled for high contrast / reduced motion.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AdminModal
      open={open}
      title={title}
      onClose={loading ? () => {} : onCancel}
      widthClass="max-w-md"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-full px-5 py-2.5 text-sm font-bold text-text-secondary hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded-full px-5 py-2.5 text-sm font-bold bg-brand text-white hover:bg-brand-dark disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-text-secondary font-medium leading-relaxed">{message}</p>
    </AdminModal>
  );
}
