"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { filesFromDrop } from "@/lib/import/file-accept";

export function UploadModal({
  open,
  title,
  description,
  accept,
  processingLabel = "Procesando…",
  multiple = false,
  onClose,
  onFile,
  onFiles,
}: {
  open: boolean;
  title: string;
  description: string;
  accept: string;
  processingLabel?: string;
  /** Allow selecting / dropping several files (uses onFiles if set, else onFile per file) */
  multiple?: boolean;
  onClose: () => void;
  /** Return void/Promise; throw Error with message on failure */
  onFile?: (file: File) => Promise<void>;
  /** Batch handler when multiple is true */
  onFiles?: (files: File[]) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDragOver(false);
      setLoading(false);
      setError(null);
      setFileName(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  const processMany = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setFileName(
        files.length === 1
          ? files[0].name
          : `${files.length} archivos`,
      );
      setLoading(true);
      try {
        if (onFiles) {
          await onFiles(files);
        } else if (onFile) {
          for (const f of files) {
            setFileName(files.length > 1 ? `${f.name}…` : f.name);
            await onFile(f);
          }
        } else {
          throw new Error("No hay handler de archivos");
        }
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al procesar");
      } finally {
        setLoading(false);
      }
    },
    [onFile, onFiles, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
        aria-label="Cerrar"
        disabled={loading}
        onClick={() => {
          if (!loading) onClose();
        }}
      />
      <div className="animate-fade-up relative z-10 w-full max-w-md rounded-3xl border border-emerald-900/10 bg-white p-5 shadow-2xl shadow-emerald-900/10 dark:border-white/10 dark:bg-zinc-950 dark:shadow-black/50 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="upload-modal-title"
              className="text-lg font-bold tracking-tight"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              {description}
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="rounded-xl p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const list = filesFromDrop(e.dataTransfer);
            if (!list.length) {
              setError(
                "No se recibió ningún archivo. Probá elegirlo con el botón.",
              );
              return;
            }
            void processMany(multiple ? list : list.slice(0, 1));
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-all",
            dragOver
              ? "scale-[1.01] border-emerald-500 bg-emerald-50 shadow-inner dark:bg-emerald-950/40"
              : "border-zinc-300 bg-zinc-50/80 dark:border-zinc-600 dark:bg-zinc-900/50",
            loading && "pointer-events-none opacity-70",
          )}
        >
          <div
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl shadow-md",
              loading
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950"
                : "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-600/30",
            )}
          >
            {loading ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <Upload className="h-7 w-7" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold">
              {loading
                ? processingLabel
                : dragOver
                  ? "Soltá el archivo acá"
                  : "Arrastrá el archivo acá"}
            </p>
            {!loading && (
              <p className="mt-1 text-xs text-zinc-500">
                o elegilo desde tu dispositivo
              </p>
            )}
            {fileName && loading && (
              <p className="mt-2 truncate text-xs text-zinc-500">{fileName}</p>
            )}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => inputRef.current?.click()}
            className="lc-btn lc-btn-primary"
          >
            {multiple ? "Elegir archivos" : "Elegir archivo"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            className="hidden"
            onChange={(e) => {
              const list = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (!list.length) {
                setError("No se recibió ningún archivo.");
                return;
              }
              void processMany(list);
            }}
          />
        </div>

        {error && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
