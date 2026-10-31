import { Suspense } from "react";
import { LoginClient } from "@/components/login-client";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center text-sm text-[var(--muted-fg)]">
          Cargando…
        </main>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
