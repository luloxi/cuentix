"use client";

import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { formatArs, formatDateAr } from "@/lib/utils";
import { compressImageForUpload } from "@/lib/image-compress";

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
    candidates: Array<{ id: string; score: number; reason: string }>;
  };
  createdTransaction: boolean;
  imageUrl?: string;
};

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) {
    if (res.status === 413) {
      return "La foto es demasiado grande. Probá con una imagen más chica.";
    }
    return `Error ${res.status}`;
  }
  try {
    const data = JSON.parse(text) as { error?: string };
    if (data.error) return data.error;
  } catch {
    // Platform plain-text body, e.g. "Request Entity Too Large"
    if (res.status === 413 || /entity too large|payload too large/i.test(text)) {
      return "La foto es demasiado grande para subirla. La comprimimos y reintentá, o sacá otra más cerca.";
    }
    if (text.length < 200) return text;
  }
  return `Error ${res.status}`;
}

export function ReceiptUpload({ onDone }: { onDone?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0];
    // allow re-selecting same file later
    e.target.value = "";
    if (!raw) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const file = await compressImageForUpload(raw);
      setPreview(URL.createObjectURL(file));

      const fd = new FormData();
      fd.set("file", file);

      const res = await fetch("/api/receipts", {
        method: "POST",
        body: fd,
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }

      const data = (await res.json()) as UploadResult;
      setResult(data);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 px-6 py-10 text-center dark:border-emerald-800 dark:bg-emerald-950/20">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
          {loading ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : (
            <Camera className="h-7 w-7" />
          )}
        </div>
        <div>
          <p className="font-semibold">Foto del ticket de supermercado</p>
          <p className="mt-1 text-sm text-zinc-500">
            Se asocia al gasto del resumen BBVA del mismo día, o se crea si no
            existe. La foto se comprime sola al subir.
          </p>
        </div>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(ev) => void onChange(ev)}
          disabled={loading}
        />
        <span className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white">
          {loading ? "Procesando…" : "Sacar o elegir foto"}
        </span>
      </label>

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Preview ticket"
          className="mx-auto max-h-64 rounded-xl border border-zinc-200 object-contain dark:border-zinc-700"
        />
      )}

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">
                {result.ocr.merchant || "Comercio desconocido"}
              </h3>
              <p className="text-sm text-zinc-500">
                {formatDateAr(result.ocr.date)} · {formatArs(result.ocr.total)}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                result.match.transactionId || result.createdTransaction
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
              }`}
            >
              {result.createdTransaction
                ? "Gasto creado"
                : result.match.transactionId
                  ? "Asociado al banco"
                  : result.match.reason}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Match: {result.match.reason}
            {result.match.score > 0 ? ` (score ${result.match.score})` : ""}
          </p>
          {result.ocr.items.length > 0 && (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {result.ocr.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-2 py-2">
                  <span>
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
        </div>
      )}
    </div>
  );
}
