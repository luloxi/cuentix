import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { requireHousehold } from "@/lib/household";
import { normalizeBank } from "@/lib/banks";
import {
  importBbvaFile,
  importTransparenciaConsumos,
} from "@/lib/import/bbva";
import { resolvePersonalHouseholdId } from "@/lib/personal-household";

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user: sessionUser } = authResult;

  try {
    const ctx = await requireHousehold(sessionUser.id);
    const form = await req.formData();
    const file = form.get("file");
    const pasted = form.get("text");
    const kind = String(form.get("kind") ?? "bbva");
    const bank = normalizeBank(String(form.get("bank") ?? "")) ?? "BBVA";

    const pastedText = typeof pasted === "string" ? pasted.trim() : "";
    if (!(file instanceof File) && !pastedText) {
      return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
    }

    // Bank / Fiwind loads always land as Personal — Casita & IOG are assign labels.
    const personalId =
      (await resolvePersonalHouseholdId(sessionUser.id)) ?? ctx.household.id;

    if (!(file instanceof File) && kind === "transparencia") {
      return NextResponse.json(
        { error: "El texto pegado es para resúmenes, no para Transparencia." },
        { status: 400 },
      );
    }

    const buffer =
      file instanceof File
        ? Buffer.from(await file.arrayBuffer())
        : Buffer.from(pastedText, "utf8");
    const fileName =
      file instanceof File ? file.name : "pasted.statement.txt";
    const result =
      kind === "transparencia"
        ? await importTransparenciaConsumos({
            householdId: personalId,
            userId: sessionUser.id,
            fileName,
            buffer,
            bank,
          })
        : await importBbvaFile({
            householdId: personalId,
            userId: sessionUser.id,
            fileName,
            buffer,
            bank,
          });

    return NextResponse.json(result);
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
