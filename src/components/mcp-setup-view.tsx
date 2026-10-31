"use client";

import Link from "next/link";
import {
  Bot,
  Copy,
  ExternalLink,
  Check,
  KeyRound,
  RefreshCw,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader, PageStack, Surface } from "@/components/ui";
import { MCP_PUBLIC_URL, MCP_TOOLS } from "@/lib/agent/mcp-tools-meta";

const TOKEN_PLACEHOLDER = "TOKEN_DEL_HOGAR";

type TokenStatus = {
  household: { id: string; name: string } | null;
  hasToken: boolean;
  prefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  token: string | null;
};

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-fg)]">
          {label}
        </p>
        <button
          type="button"
          className="lc-btn lc-btn-ghost !px-2 !py-1 text-xs"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // ignore
            }
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Listo" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-[var(--surface-muted)] p-3 text-xs leading-relaxed text-[var(--foreground)]">
        {text}
      </pre>
    </div>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function McpSetupView() {
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "rotate" | "revoke" | null>(
    null,
  );
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const applyStatus = useCallback((data: TokenStatus & { error?: string }) => {
    setStatus({
      household: data.household ?? null,
      hasToken: Boolean(data.hasToken),
      prefix: data.prefix ?? null,
      createdAt: data.createdAt ?? null,
      lastUsedAt: data.lastUsedAt ?? null,
      token: null,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/household/agent-token", { credentials: "include" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as
          | (TokenStatus & { error?: string })
          | null;
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data?.error || `Error ${res.status}`);
          setStatus(null);
          return;
        }
        setLoadError(null);
        applyStatus(
          data ?? {
            household: null,
            hasToken: false,
            prefix: null,
            createdAt: null,
            lastUsedAt: null,
            token: null,
          },
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Error de red");
      });
    return () => {
      cancelled = true;
    };
  }, [applyStatus]);

  async function mint(action: "create" | "rotate") {
    if (action === "rotate") {
      const ok = window.confirm(
        "Rotar invalida el token anterior. Las IAs que lo tengan van a dejar de entrar. ¿Seguimos?",
      );
      if (!ok) return;
    }
    setBusy(action);
    setLoadError(null);
    try {
      const res = await fetch("/api/household/agent-token", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => null)) as
        | (TokenStatus & { error?: string; token?: string | null })
        | null;
      if (!res.ok) {
        setLoadError(data?.error || `Error ${res.status}`);
        return;
      }
      const token = data?.token ?? null;
      setPlaintext(token);
      setStatus({
        household: data?.household ?? null,
        hasToken: true,
        prefix: data?.prefix ?? null,
        createdAt: data?.createdAt ?? null,
        lastUsedAt: data?.lastUsedAt ?? null,
        token: null,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    const ok = window.confirm(
      "Revocar corta el acceso de grok.com y de cualquier otra IA que tenga este token. ¿Seguimos?",
    );
    if (!ok) return;
    setBusy("revoke");
    setLoadError(null);
    try {
      const res = await fetch("/api/household/agent-token", {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as
        | (TokenStatus & { error?: string })
        | null;
      if (!res.ok) {
        setLoadError(data?.error || `Error ${res.status}`);
        return;
      }
      setPlaintext(null);
      applyStatus(
        data ?? {
          household: null,
          hasToken: false,
          prefix: null,
          createdAt: null,
          lastUsedAt: null,
          token: null,
        },
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(null);
    }
  }

  const snippetToken = plaintext ?? TOKEN_PLACEHOLDER;

  const grokCli = `grok mcp add --transport http llevacuentas \\
  ${MCP_PUBLIC_URL} \\
  --header "Authorization: Bearer ${snippetToken}"`;

  const grokToml = `[mcp_servers.llevacuentas]
url = "${MCP_PUBLIC_URL}"
headers = { Authorization = "Bearer ${snippetToken}" }`;

  const cursorJson = `{
  "mcpServers": {
    "llevacuentas": {
      "url": "${MCP_PUBLIC_URL}",
      "headers": {
        "Authorization": "Bearer ${snippetToken}"
      }
    }
  }
}`;

  return (
    <PageStack>
      <PageHeader
        eyebrow="Agentes"
        title="MCP remoto"
        description="Conectá Cuentix a grok.com u otra IA con un token de este hogar. Ese token no ve los datos de otro hogar."
      />

      <Surface className="space-y-2 border border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/30">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Importante: tus datos salen de Cuentix
        </p>
        <p className="text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90">
          Cuando conectás una IA (grok.com, Cursor u otra) por MCP, los
          movimientos y resúmenes que consultás o importás{" "}
          <strong>salen de Cuentix hacia esa IA</strong>. Es el punto: el
          agente los lee para ayudarte. Si no querés eso, no conectes MCP.
        </p>
        <p className="text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90">
          <strong>Nunca pegues el token en un chat</strong>, ni en issues, ni
          en el repo. Si se filtró, rotálo acá: el anterior deja de andar. Polar
          (suscripción) sigue aparte y pausado: esto no lo toca.
        </p>
      </Surface>

      <Surface elevated className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-fg)]">
            <KeyRound className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              Token de este hogar
            </p>
            <p className="text-sm leading-relaxed text-[var(--muted-fg)]">
              Se genera acá, se guarda hasheado y se muestra una sola vez.
              Copialo en grok.com (header{" "}
              <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--foreground)]">
                Authorization: Bearer
              </code>
              ) u otro cliente MCP. No uses el{" "}
              <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--foreground)]">
                AGENT_API_TOKEN
              </code>{" "}
              de Vercel: eso es fallback admin/dev y apunta a un solo hogar de
              prueba.
            </p>
            {status?.household && (
              <p className="text-xs text-[var(--muted-fg)]">
                Hogar:{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {status.household.name}
                </span>
              </p>
            )}
          </div>
        </div>

        {loadError && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
            {loadError}
          </p>
        )}

        {plaintext && (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-50/70 p-3 dark:bg-amber-950/25">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <p className="text-sm leading-relaxed text-amber-950 dark:text-amber-100">
                Guardalo ahora. No lo volvemos a mostrar. Si lo perdés, rotálo.
              </p>
            </div>
            <pre className="overflow-x-auto break-all rounded-lg bg-[var(--surface)] p-3 font-mono text-xs text-[var(--foreground)]">
              {plaintext}
            </pre>
            <button
              type="button"
              className="lc-btn lc-btn-primary !px-3 !py-2 text-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(plaintext);
                  setCopiedToken(true);
                  setTimeout(() => setCopiedToken(false), 1600);
                } catch {
                  // ignore
                }
              }}
            >
              {copiedToken ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copiedToken ? "Copiado" : "Copiar token"}
            </button>
          </div>
        )}

        {!plaintext && status?.hasToken && (
          <p className="text-sm text-[var(--muted-fg)]">
            Token activo:{" "}
            <code className="rounded bg-[var(--surface-muted)] px-1 font-mono text-[var(--foreground)]">
              {status.prefix}…
            </code>
            {status.createdAt && (
              <>
                {" "}
                · creado {formatWhen(status.createdAt)}
              </>
            )}
            {status.lastUsedAt && (
              <>
                {" "}
                · último uso {formatWhen(status.lastUsedAt)}
              </>
            )}
            . El valor completo no se puede volver a ver.
          </p>
        )}

        {!status?.hasToken && !plaintext && (
          <p className="text-sm text-[var(--muted-fg)]">
            Este hogar todavía no tiene token. Generálo para conectar una IA.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {!status?.hasToken ? (
            <button
              type="button"
              className="lc-btn lc-btn-primary !px-3 !py-2 text-sm"
              disabled={busy !== null}
              onClick={() => void mint("create")}
            >
              <KeyRound className="h-4 w-4" />
              {busy === "create" ? "Generando…" : "Generar token del hogar"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="lc-btn lc-btn-secondary !px-3 !py-2 text-sm"
                disabled={busy !== null}
                onClick={() => void mint("rotate")}
              >
                <RefreshCw className="h-4 w-4" />
                {busy === "rotate" ? "Rotando…" : "Rotar token"}
              </button>
              <button
                type="button"
                className="lc-btn lc-btn-ghost !px-3 !py-2 text-sm"
                disabled={busy !== null}
                onClick={() => void revoke()}
              >
                <Trash2 className="h-4 w-4" />
                {busy === "revoke" ? "Revocando…" : "Revocar"}
              </button>
            </>
          )}
        </div>
      </Surface>

      <Surface elevated className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-fg)]">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              URL del servidor MCP
            </p>
            <p className="break-all font-mono text-sm text-[var(--brand-fg)]">
              {MCP_PUBLIC_URL}
            </p>
            <p className="text-xs text-[var(--muted-fg)]">
              Transporte: Streamable HTTP. Auth:{" "}
              <code className="rounded bg-[var(--surface-muted)] px-1">
                Authorization: Bearer &lt;token del hogar&gt;
              </code>
            </p>
          </div>
        </div>
        <CopyBlock label="URL" text={MCP_PUBLIC_URL} />
      </Surface>

      <Surface className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          1. Cómo pegarlo en grok.com u otra IA
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted-fg)]">
          <li>
            Generá el token arriba y copialo (es la única vez que lo vas a
            ver).
          </li>
          <li>
            En <strong className="text-[var(--foreground)]">grok.com</strong>:
            agregá un servidor MCP remoto (Streamable HTTP) con la URL de
            arriba. En headers poné{" "}
            <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--foreground)]">
              Authorization
            </code>{" "}
            ={" "}
            <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--foreground)]">
              Bearer PEGÁ_EL_TOKEN
            </code>
            . No lo escribas en el chat: va en la config del MCP.
          </li>
          <li>
            En Grok CLI o Cursor, usá los bloques de abajo (reemplazá{" "}
            <code className="rounded bg-[var(--surface-muted)] px-1 text-[var(--foreground)]">
              {TOKEN_PLACEHOLDER}
            </code>{" "}
            si no lo generaste recién).
          </li>
        </ol>
      </Surface>

      <Surface className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          2. Cómo agregarlo
        </h2>

        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--foreground)]">
            grok.com / Grok CLI
          </p>
          <CopyBlock label="Comando" text={grokCli} />
          <CopyBlock label="~/.grok/config.toml" text={grokToml} />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--foreground)]">
            Cursor u otro cliente MCP (JSON)
          </p>
          <CopyBlock label="mcp.json" text={cursorJson} />
        </div>
      </Surface>

      <Surface className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          3. Tools disponibles
        </h2>
        <ul className="divide-y divide-[var(--border)]">
          {MCP_TOOLS.map((t) => (
            <li
              key={t.name}
              className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0"
            >
              <code className="text-sm font-medium text-[var(--brand-fg)]">
                {t.name}
              </code>
              <span className="text-sm text-[var(--muted-fg)]">{t.summary}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--muted-fg)]">
          Para importar: el cliente manda{" "}
          <code className="rounded bg-[var(--surface-muted)] px-1">
            fileBase64
          </code>{" "}
          (bytes del Excel/PDF en base64) +{" "}
          <code className="rounded bg-[var(--surface-muted)] px-1">fileName</code>
          . Misma lógica que la API HTTP. Todo queda en el hogar de este token.
        </p>
      </Surface>

      <Surface className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          Docs
        </h2>
        <p className="text-sm text-[var(--muted-fg)]">
          Detalle curl + MCP en{" "}
          <code className="rounded bg-[var(--surface-muted)] px-1">
            docs/agent-api.md
          </code>{" "}
          del repo. También podés usar la API HTTP (
          <code className="rounded bg-[var(--surface-muted)] px-1">
            /api/agent/*
          </code>
          ) con el mismo bearer del hogar. La PWA sigue con la cookie de
          sesión; esto es para máquinas e IAs.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/cargas"
            className="lc-btn lc-btn-ghost !px-3 !py-2 text-sm"
          >
            Ir a Cargas
          </Link>
          <Link
            href="/compartido"
            className="lc-btn lc-btn-ghost !px-3 !py-2 text-sm"
          >
            Ir al hogar
          </Link>
          <a
            href="https://github.com/luloxi/cuentix/blob/main/docs/agent-api.md"
            target="_blank"
            rel="noreferrer"
            className="lc-btn lc-btn-ghost !px-3 !py-2 text-sm"
          >
            docs/agent-api.md
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </Surface>
    </PageStack>
  );
}
