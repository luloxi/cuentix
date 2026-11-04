"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AddExpenseModal } from "@/components/add-expense-modal";
import { useJsonResource } from "@/hooks/use-json-resource";

type Category = { id: string; slug: string; name: string };
type Member = { userId: string; name: string };

export type AddExpensePreset = {
  categorySlug?: string;
  ownership?: "personal" | "shared";
  paidByUserId?: string;
  description?: string;
  /** Skip choose screen and open manual form directly */
  mode?: "manual" | "choose";
};

type Ctx = {
  openAddExpense: (preset?: AddExpensePreset) => void;
};

const AddExpenseContext = createContext<Ctx>({
  openAddExpense: () => {},
});

export function useAddExpense() {
  return useContext(AddExpenseContext);
}

export function AddExpenseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<AddExpensePreset | null>(null);
  const me = useJsonResource<{
    user?: { id?: string };
    members?: Member[];
  }>("/api/me", [], { staleWhileReload: true });
  const cats = useJsonResource<{ categories?: Category[] }>("/api/categories", [], {
    staleWhileReload: true,
  });
  const members = me.data?.members ?? [];
  const viewerUserId = me.data?.user?.id ?? null;
  const categories = cats.data?.categories ?? [];
  const reloadMe = me.reload;
  const reloadCats = cats.reload;

  const openAddExpense = useCallback(
    (nextPreset?: AddExpensePreset) => {
      setPreset(nextPreset ?? null);
      setOpen(true);
      void reloadMe();
      void reloadCats();
    },
    [reloadMe, reloadCats],
  );

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<AddExpensePreset | undefined>).detail;
      openAddExpense(detail);
    }
    window.addEventListener("lc:open-add-expense", onOpen);
    return () => window.removeEventListener("lc:open-add-expense", onOpen);
  }, [openAddExpense]);

  return (
    <AddExpenseContext.Provider value={{ openAddExpense }}>
      {children}
      <AddExpenseModal
        open={open}
        onClose={() => {
          setOpen(false);
          setPreset(null);
        }}
        onCreated={() => {
          setOpen(false);
          setPreset(null);
          window.dispatchEvent(new Event("lc:expense-created"));
        }}
        categories={categories}
        members={members}
        viewerUserId={viewerUserId}
        preset={preset}
      />
    </AddExpenseContext.Provider>
  );
}
