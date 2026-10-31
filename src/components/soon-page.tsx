export function SoonPage({ title }: { title: string }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm text-[var(--muted-fg)]">Disponible pronto</p>
    </div>
  );
}
