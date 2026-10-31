import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { requireHousehold } from "@/lib/household";
import { reclassifyFiwindNoise } from "@/lib/import/reclassify-fiwind";

export async function POST() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const ctx = await requireHousehold(user.id);
    const result = await reclassifyFiwindNoise(ctx.household.id, {
      userId: user.id,
    });
    const message = (() => {
      const bits: string[] = [];
      if (result.internalMarked > 0) {
        bits.push(`${result.internalMarked} Transferencia interna`);
      }
      if ((result.internalUpserted ?? 0) > 0) {
        bits.push(
          `${result.internalUpserted} pasado${result.internalUpserted === 1 ? "" : "s"} a Consumos`,
        );
      }
      if (result.incomesRemoved > 0) {
        bits.push(
          `${result.incomesRemoved} ingreso${result.incomesRemoved === 1 ? "" : "s"} self/FX quitado${result.incomesRemoved === 1 ? "" : "s"}`,
        );
      }
      const other = result.updated - (result.internalMarked ?? 0);
      if (other > 0) {
        bits.push(`${other} ruido Fiwind → Conversiones`);
      }
      if (bits.length === 0) {
        return result.alreadyOk > 0
          ? `Nada nuevo: ${result.alreadyOk} ya estaban bien. No se borraron movimientos.`
          : "No había ruido Fiwind / self-transfer para reclasificar.";
      }
      return `Listo: ${bits.join(" · ")}. Movimientos no se borran.`;
    })();
    return NextResponse.json({ ok: true, ...result, message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "NO_HOUSEHOLD") {
      return NextResponse.json(
        { error: "Creá o uníte a un hogar primero" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}