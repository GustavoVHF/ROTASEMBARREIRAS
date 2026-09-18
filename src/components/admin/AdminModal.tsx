"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

interface AdminModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Sticky action row pinned to the bottom of the modal. */
  footer?: React.ReactNode;
  /** Tailwind max-width class for the panel. Defaults to a comfortable form width. */
  widthClass?: string;
}

/**
 * Modal shell for the admin panel.
 *
 * Layout contract (fixes the bugs the old panel had):
 *  - The overlay itself is the scroll-safe container: `p-4 sm:p-6` keeps a
 *    guaranteed margin from every screen edge, so the panel never touches
 *    the viewport border or gets clipped.
 *  - Panel is capped at `max-h-[calc(100dvh-2rem)]` and split into
 *    header / scrollable body / footer, so long forms scroll INSIDE the
 *    modal instead of overflowing the page (the app's html has
 *    `overflow: hidden`, so page-level scroll is never available).
 *  - Escape closes, backdrop click closes, body of the page can't be
 *    scrolled behind it (overscroll-contain on the body region).
 */
export default function AdminModal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  widthClass = "max-w-2xl",
}: AdminModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  // z-[10000] keeps the panel above the VLibras widget, which globals.css
  // pins at z-index 9999 with !important.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${widthClass} max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden`}
      >
        <header className="flex-shrink-0 flex items-start gap-4 px-6 py-5 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-black text-text-main leading-tight truncate">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-xs text-text-secondary font-semibold truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 text-text-secondary hover:bg-gray-200 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex-shrink-0 px-6 py-4 border-t border-gray-100 bg-white flex items-center justify-end gap-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
