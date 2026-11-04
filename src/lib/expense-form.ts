export type ExpenseCategoryRef = { id: string; slug: string };
export type ExpenseMemberRef = { userId: string };

export type ExpensePreset = {
  categorySlug?: string;
  ownership?: "personal" | "shared";
  paidByUserId?: string;
  description?: string;
  mode?: "manual" | "choose";
};

export type ExpenseLineInput = {
  lineTotal: string;
  quantity: string;
  unitPrice: string;
};

export type ExpenseDraft = {
  mode: "choose" | "manual";
  date: string;
  description: string;
  amountArs: string;
  amountUsd: string;
  categoryId: string;
  paidByUserId: string;
  ownership: "personal" | "shared";
};

/**
 * Category to select while the modal is open.
 * Returns null when the current value should stay.
 * A preset slug wins over a manual pick — same as the old effect.
 */
export function nextCategoryId(
  current: string,
  categories: readonly ExpenseCategoryRef[],
  presetSlug?: string,
): string | null {
  if (presetSlug && categories.length > 0) {
    const cat = categories.find((c) => c.slug === presetSlug);
    if (cat) return current === cat.id ? null : cat.id;
  }
  if (!current && categories.length > 0) {
    return (
      categories.find((c) => c.slug === "uncategorized")?.id ??
      categories[0]!.id
    );
  }
  return null;
}

/** Payer to select when none is chosen yet. Null means keep the current one. */
export function nextPayerId(
  current: string,
  members: readonly ExpenseMemberRef[],
  presetPayer: string | undefined,
  viewerUserId: string | null,
): string | null {
  if (current || members.length === 0) return null;
  if (presetPayer && members.some((m) => m.userId === presetPayer)) {
    return presetPayer;
  }
  if (viewerUserId && members.some((m) => m.userId === viewerUserId)) {
    return viewerUserId;
  }
  return members[0]!.userId;
}

export function buildExpenseDraft(input: {
  preset: ExpensePreset | null;
  categories: readonly ExpenseCategoryRef[];
  members: readonly ExpenseMemberRef[];
  viewerUserId: string | null;
  today: string;
}): ExpenseDraft {
  const preset = input.preset;
  return {
    mode: preset?.mode === "manual" ? "manual" : "choose",
    date: input.today,
    description: preset?.description ?? "",
    amountArs: "",
    amountUsd: "",
    categoryId:
      nextCategoryId("", input.categories, preset?.categorySlug) ?? "",
    paidByUserId:
      nextPayerId(
        "",
        input.members,
        preset?.paidByUserId,
        input.viewerUserId,
      ) ?? "",
    ownership: preset?.ownership === "shared" ? "shared" : "personal",
  };
}

/** Sum of manual line items. Non-numeric totals fall back to qty × unit price. */
export function lineItemsTotal(items: readonly ExpenseLineInput[]): number {
  return items.reduce((sum, item) => {
    let line = parseFloat(item.lineTotal.replace(",", "."));
    if (!Number.isFinite(line)) {
      const quantity = parseFloat(item.quantity.replace(",", ".")) || 0;
      const unit = parseFloat(item.unitPrice.replace(",", ".")) || 0;
      line = quantity * unit;
    }
    return sum + (Number.isFinite(line) ? line : 0);
  }, 0);
}
