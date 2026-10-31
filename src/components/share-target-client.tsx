"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { compressImageForUpload } from "@/lib/image-compress";
import { formatArs, formatDateAr } from "@/lib/utils";

const CACHE_NAME = "lc-share-target-v1";
const SHARED_FILE_KEY = "shared-comprobante";

type UploadResult = {
  ocr: {
    merchant: string | null;
    date: string | null;
    total: number | null;
    items: Array<{
      name: string;
      quantity: number | null;
      unit_price: number | null;
      line_total: number | null;
    }>;
  };
  match: {
    transactionId: string | null;
    score: number;
    reason: string;
  };
  createdTransaction: boolean;
};

type StatementResult = {
  total: number;
  inserted: number;
  alreadyExists: number;
  message: string;
  warning: string | null;
  bank: string | null;
};

async function loadSharedFile(): Promise<File | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(SHARED_FILE_KEY);
    if (!response) return null;

    const blob = await response.blob();
    const nameHeader = response.headers.get("X-File-Name");
    const name = nameHeader
      ? decodeURIComponent(nameHeader)
      : "comprobante.jpg";
    const type = response.headers.get("Content-Type") || blob.type || "image/jpeg";

    // Clean up so the next share starts fresh
    await cache.delete(SHARED_FILE_KEY);
    await cache.delete("shared-meta");

    return new File([blob], name, { type, lastModified: Date.now() });
  } catch (err) {
    console.error("[share-target] loadSharedFile", err);
    return null;
  }
}

export function ShareTargetClient() {
  const router = useRouter();
  const [status, setStatus] = useState<
    "loading" | "processing" | "done" | "error" | "empty"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [statement, setStatement] = useState<StatementResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const file = await loadSharedFile();
      if (cancelled) return;

      if (!file) {
        setStatus("empty");
        return;
      }

      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        setStatus("processing");
        try {
          const fd = new FormData();
          fd.set("file", file);
          fd.set("kind", "bbva");
          const lower = file.name.toLowerCase();
          fd.set(
            "bank",
            lower.includes("fiwind")
              ? "Fiwind"
              : lower.includes("bbva")
                ? "BBVA"
                : "BBVA",
          );
          const res = await fetch("/api/import/bbva", {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const text = await res.text();
          let data: {
            error?: string;
            total?: number;
            inserted?: number;
            alreadyExists?: number;
            skipped?: number;
            message?: string;
            warning?: string | null;
            hint?: string | null;
            bank?: string;
          } | null = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            throw new Error(
              res.status === 401
                ? "Entrá a la app e intentá compartir de nuevo."
                : text.slice(0, 160) || `Error ${res.status}`,
            );
          }
          if (!res.ok) {
            throw new Error(data?.error || `Error al importar ${file.name}`);
          }
          if ((data?.total ?? 0) === 0) {
            throw new Error(
              `${data?.message || "No se leyeron movimientos del PDF."}${
                data?.hint ? ` ${data.hint}` : ""
              }`,
            );
          }
          if (cancelled) return;
          setStatement({
            total: data?.total ?? 0,
            inserted: data?.inserted ?? 0,
            alreadyExists: data?.alreadyExists ?? data?.skipped ?? 0,
            message: data?.message ?? "",
            warning: data?.warning ?? null,
            bank: data?.bank ?? null,
          });
          setStatus("done");
          window.dispatchEvent(new Event("lc:card-imported"));
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Error al importar el PDF");
          setStatus("error");
        }
        return;
      }

      setStatus("processing");
      setPreview(URL.createObjectURL(file));

      try {
        const compressed = await compressImageForUpload(file);
        const fd = new FormData();
        fd.set("file", compressed);

        const res = await fetch("/api/receipts", {
          method: "POST",
          body: fd,
          credentials: "include",
        });

        if (!res.ok) {
          const text = await res.text();
          let msg = `Error ${res.status}`;
          try {
            const data = JSON.parse(text) as { error?: string };
            if (data.error) msg = data.error;
          } catch {
            if (text.length < 200) msg = text;
          }
          throw new Error(msg);
        }

        const data = (await res.json()) as UploadResult;
        if (cancelled) return;
        setResult(data);
        setStatus("done");
        window.dispatchEvent(new Event("lc:expense-created"));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Error al procesar");
        setStatus("error");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="text-center">
        <h1 className="text-xl font-bold tracking-tight">Comprobante compartido</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {status === "loading" && "Buscando archivo…"}
          {status === "processing" && "Procesando…"}
          {status === "done" && "Listo"}
          {status === "error" && "Algo salió mal"}
          {status === "empty" && "No llegó ningún archivo"}
        </p>
      </div>

      {(status === "loading" || status === "processing") && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 py-12 dark:border-zinc-800 dark:bg-zinc-900/40">
          <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
          <p className="text-sm text-zinc-500">
            {status === "loading"
              ? "Leyendo el comprobante…"
              : "Leyendo el archivo…"}
          </p>
        </div>
      )}

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Comprobante"
          className="mx-auto max-h-56 rounded-xl border border-zinc-200 object-contain dark:border-zinc-700"
        />
      )}

      {status === "empty" && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 py-10 text-center dark:border-zinc-700">
          <Camera className="h-10 w-10 text-zinc-400" />
          <p className="text-sm text-zinc-500">
            No encontramos un archivo compartido. Probá de nuevo desde la app del
            banco o la galería.
          </p>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="lc-btn lc-btn-primary mt-2"
          >
            Ir al dashboard
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm text-red-700 dark:text-red-200">
              {error || "No se pudo procesar el comprobante."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="lc-btn lc-btn-primary w-full"
          >
            Volver
          </button>
        </div>
      )}

      {status === "done" && statement && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                Resumen importado
                {statement.bank ? ` · ${statement.bank}` : ""}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {statement.message ||
                  `${statement.inserted} nuevos · ${statement.alreadyExists} coincidencias`}
              </p>
              {statement.warning && (
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                  {statement.warning}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push("/cargas")}
              className="lc-btn lc-btn-primary flex-1"
            >
              Ver cargas
            </button>
            <button
              type="button"
              onClick={() => router.push("/consumos")}
              className="lc-btn flex-1"
            >
              Ver consumos
            </button>
          </div>
        </div>
      )}

      {status === "done" && result && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {result.ocr.merchant || "Comercio desconocido"}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {formatDateAr(result.ocr.date)} · {formatArs(result.ocr.total)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {result.createdTransaction
                  ? "Gasto creado desde el comprobante"
                  : result.match.transactionId
                    ? "Asociado a un movimiento del banco"
                    : result.match.reason}
              </p>
            </div>
          </div>

          {result.ocr.items.length > 0 && (
            <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
              {result.ocr.items.slice(0, 12).map((item, i) => (
                <li key={i} className="flex justify-between gap-2 px-4 py-2.5">
                  <span className="truncate">
                    {item.quantity && item.quantity !== 1
                      ? `${item.quantity}× `
                      : ""}
                    {item.name}
                  </span>
                  <span className="tabular-nums text-zinc-600">
                    {formatArs(item.line_total)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="lc-btn lc-btn-primary flex-1"
            >
              Ir al dashboard
            </button>
            <button
              type="button"
              onClick={() => router.push("/consumos")}
              className="lc-btn flex-1"
            >
              Ver consumos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
