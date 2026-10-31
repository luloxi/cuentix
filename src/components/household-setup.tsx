"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { Home, User, UserPlus } from "lucide-react";

export function HouseholdSetup() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteFromUrl = (searchParams.get("invite") || "").toUpperCase();
  const invited = inviteFromUrl.length >= 6;

  const [name, setName] = useState("Nuestro hogar");
  const [code, setCode] = useState(inviteFromUrl);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<
    "create" | "join" | "solo" | null
  >(null);

  async function create() {
    setLoading("create");
    setError(null);
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "create", name }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      router.refresh();
      router.push("/compartido");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(null);
    }
  }

  async function continueSolo() {
    setLoading("solo");
    setError(null);
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "create", name: "Mi espacio" }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      router.refresh();
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(null);
    }
  }

  async function join() {
    setLoading("join");
    setError(null);
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "join", code }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      router.refresh();
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="app-shell mx-auto w-full max-w-md animate-fade-up space-y-5 px-1">
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <BrandLogo size={48} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {invited ? "Te invitaron al hogar" : "Tu espacio"}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted-fg)]">
          {invited
            ? "Entrá con el código y quedás en las cuentas compartidas."
            : "Creá tu hogar (podés usarlo solo) o uníte con un código."}
        </p>
      </div>

      {invited ? (
        <div className="lc-card-elevated space-y-3 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-fg)]">
              <UserPlus className="h-4 w-4" />
            </div>
            <h2 className="font-semibold tracking-tight">Unirme al hogar</h2>
          </div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="lc-input w-full uppercase tracking-widest"
            placeholder="ABCD1234"
            maxLength={8}
            disabled={loading !== null}
            autoFocus
          />
          <button
            type="button"
            disabled={loading !== null || code.length < 6}
            onClick={() => void join()}
            className="lc-btn lc-btn-primary w-full"
          >
            {loading === "join" ? "Uniéndome…" : "Unirme"}
          </button>
        </div>
      ) : (
        <>
          <div className="lc-card-elevated space-y-3 p-5">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-fg)]">
                <Home className="h-4 w-4" />
              </div>
              <h2 className="font-semibold tracking-tight">Crear el hogar</h2>
            </div>
            <p className="text-xs leading-relaxed text-[var(--muted-fg)]">
              Podés usarlo solo. Si más adelante querés sumar a alguien, hay un
              Invitar opcional en Hogar.
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="lc-input w-full"
              placeholder="Nombre del hogar"
              disabled={loading !== null}
            />
            <button
              type="button"
              disabled={loading !== null}
              onClick={() => void create()}
              className="lc-btn lc-btn-primary w-full"
            >
              {loading === "create" ? "Creando…" : "Crear hogar"}
            </button>
          </div>

          <div className="lc-card space-y-3 p-5">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--warm-soft)] text-[var(--warm)]">
                <UserPlus className="h-4 w-4" />
              </div>
              <h2 className="font-semibold tracking-tight">Unirme con código</h2>
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="lc-input w-full uppercase tracking-widest"
              placeholder="ABCD1234"
              maxLength={8}
              disabled={loading !== null}
            />
            <button
              type="button"
              disabled={loading !== null || code.length < 6}
              onClick={() => void join()}
              className="lc-btn lc-btn-secondary w-full"
            >
              {loading === "join" ? "Uniéndome…" : "Unirme"}
            </button>
          </div>

          <button
            type="button"
            disabled={loading !== null}
            onClick={() => void continueSolo()}
            className="flex w-full items-center gap-3 px-2 py-2 text-left text-sm text-[var(--muted-fg)] transition hover:text-[var(--foreground)] disabled:opacity-60"
          >
            <User className="h-4 w-4 shrink-0" />
            <span>
              {loading === "solo"
                ? "Preparando…"
                : "Seguir solo por ahora"}
            </span>
          </button>
        </>
      )}

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
