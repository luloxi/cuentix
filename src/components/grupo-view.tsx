"use client";

import { useEffect, useState } from "react";
import { GroupPanel } from "@/components/group-panel";
import { LoadingBlock } from "@/components/ui";

type Member = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
};

type Payload = {
  householdName: string;
  inviteCode: string;
  members: Member[];
};

export function GrupoView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      setError(null);
      void fetch("/api/grupo", { credentials: "include" })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as (Payload & { error?: string }) | null;
          if (cancelled) return;
          if (!res.ok || !body?.inviteCode) {
            setData(null);
            setError(body?.error === "NO_HOUSEHOLD" ? "Todavía no hay un hogar." : body?.error || `Error ${res.status}`);
            return;
          }
          setData(body);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Error de red");
        });
    }
    load();
    window.addEventListener("lc:household-switched", load);
    return () => {
      cancelled = true;
      window.removeEventListener("lc:household-switched", load);
    };
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <LoadingBlock label="Cargando grupo…" />;
  return <GroupPanel inviteCode={data.inviteCode} members={data.members} />;
}
