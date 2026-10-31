import { NextResponse } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { requireHousehold } from "@/lib/household";
import { getDb, schema } from "@/lib/db";

function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "cat";
}

/** List categories for this household (system + custom), with hidden flag. */
export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const ctx = await requireHousehold(user.id);
    const db = (await getDb());

    const cats = await db
      .select()
      .from(schema.categories)
      .where(
        or(
          isNull(schema.categories.householdId),
          eq(schema.categories.householdId, ctx.household.id),
        ),
      );

    const hiddenRows = await db
      .select()
      .from(schema.householdCategoryPrefs)
      .where(
        and(
          eq(schema.householdCategoryPrefs.householdId, ctx.household.id),
          eq(schema.householdCategoryPrefs.hidden, true),
        ),
      );
    const hidden = new Set(hiddenRows.map((r) => r.categoryId));

    const list = cats
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        kind: c.kind,
        isSystem: c.isSystem,
        householdId: c.householdId,
        hidden: hidden.has(c.id),
        canDelete: !c.isSystem && c.householdId === ctx.household.id,
      }))
      .sort((a, b) => {
        if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
        return a.name.localeCompare(b.name, "es");
      });

    return NextResponse.json({ categories: list });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "NO_HOUSEHOLD") {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Create a custom category for this household. */
export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const ctx = await requireHousehold(user.id);
    const body = (await req.json()) as { name?: string };
    const name = (body.name || "").trim();
    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: "Poné un nombre de al menos 2 letras" },
        { status: 400 },
      );
    }
    if (name.length > 48) {
      return NextResponse.json(
        { error: "El nombre es demasiado largo" },
        { status: 400 },
      );
    }

    const db = (await getDb());
    let slug = slugify(name);
    const existing = await db
      .select({ slug: schema.categories.slug })
      .from(schema.categories);
    const taken = new Set(existing.map((r) => r.slug));
    if (taken.has(slug)) {
      let i = 2;
      while (taken.has(`${slug}-${i}`)) i++;
      slug = `${slug}-${i}`;
    }

    const [row] = await db
      .insert(schema.categories)
      .values({
        slug,
        name,
        kind: "expense",
        defaultOwnership: "personal",
        isSystem: false,
        householdId: ctx.household.id,
      })
      .returning();

    return NextResponse.json(
      {
        category: {
          id: row.id,
          slug: row.slug,
          name: row.name,
          kind: row.kind,
          isSystem: false,
          householdId: row.householdId,
          hidden: false,
          canDelete: true,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

/** Hide/show a category, or rename a custom one. */
export async function PATCH(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const ctx = await requireHousehold(user.id);
    const body = (await req.json()) as {
      id?: string;
      hidden?: boolean;
      name?: string;
    };
    if (!body.id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const db = (await getDb());
    const [cat] = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, body.id))
      .limit(1);

    if (!cat) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }
    if (cat.householdId && cat.householdId !== ctx.household.id) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    // Never hide uncategorized — always needed as fallback
    if (cat.slug === "uncategorized" && body.hidden === true) {
      return NextResponse.json(
        { error: "No se puede ocultar Sin categoría" },
        { status: 400 },
      );
    }

    if (typeof body.hidden === "boolean") {
      if (body.hidden) {
        await db
          .insert(schema.householdCategoryPrefs)
          .values({
            householdId: ctx.household.id,
            categoryId: cat.id,
            hidden: true,
          })
          .onConflictDoUpdate({
            target: [
              schema.householdCategoryPrefs.householdId,
              schema.householdCategoryPrefs.categoryId,
            ],
            set: { hidden: true },
          });
      } else {
        await db
          .delete(schema.householdCategoryPrefs)
          .where(
            and(
              eq(schema.householdCategoryPrefs.householdId, ctx.household.id),
              eq(schema.householdCategoryPrefs.categoryId, cat.id),
            ),
          );
      }
    }

    if (typeof body.name === "string" && body.name.trim()) {
      if (cat.isSystem || cat.householdId !== ctx.household.id) {
        return NextResponse.json(
          { error: "Solo podés renombrar categorías propias" },
          { status: 403 },
        );
      }
      await db
        .update(schema.categories)
        .set({ name: body.name.trim() })
        .where(eq(schema.categories.id, cat.id));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

/** Delete a custom category. Moves its expenses to Uncategorized. */
export async function DELETE(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const ctx = await requireHousehold(user.id);
    const body = (await req.json()) as { id?: string };
    if (!body.id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const db = (await getDb());
    const [cat] = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, body.id))
      .limit(1);

    if (!cat) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }
    if (cat.isSystem || cat.householdId !== ctx.household.id) {
      return NextResponse.json(
        { error: "Solo podés borrar categorías que creaste" },
        { status: 403 },
      );
    }

    const [uncat] = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.slug, "uncategorized"))
      .limit(1);

    if (uncat) {
      await db
        .update(schema.transactions)
        .set({ categoryId: uncat.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.transactions.householdId, ctx.household.id),
            eq(schema.transactions.categoryId, cat.id),
          ),
        );
    }

    await db
      .delete(schema.householdCategoryPrefs)
      .where(eq(schema.householdCategoryPrefs.categoryId, cat.id));

    await db
      .delete(schema.merchantRules)
      .where(eq(schema.merchantRules.categoryId, cat.id));

    await db.delete(schema.categories).where(eq(schema.categories.id, cat.id));

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
