"use client";

import { useState } from "react";

export function LoginView() {
  const [accessKey, setAccessKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessKey }),
      });
      if (response.status === 401) {
        setError("Clave incorrecta.");
        return;
      }
      if (!response.ok) {
        setError("No se pudo entrar.");
        return;
      }
      window.location.assign("/gastos/");
    } catch {
      setError("No se pudo entrar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login">
      <form className="card" onSubmit={(event) => void submit(event)}>
        <p className="wordmark">Cuentix</p>
        <h1>Entrar</h1>
        <label>
          Clave de acceso
          <input
            type="password"
            name="accessKey"
            autoComplete="current-password"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </button>
        {error ? <p className="note bad">{error}</p> : null}
      </form>
    </main>
  );
}
