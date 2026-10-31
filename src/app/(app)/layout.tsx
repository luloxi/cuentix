import { Suspense } from "react";
import { AppNav } from "@/components/app-nav";
import { AddExpenseProvider } from "@/components/add-expense-provider";
import { AuthGate } from "@/components/auth-gate";
import { SectionSwipe } from "@/components/section-swipe";
import { RegisterServiceWorker } from "@/components/register-sw";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell flex min-h-dvh flex-col">
      <RegisterServiceWorker />
      <AuthGate>
        <AddExpenseProvider>
          <AppNav />
          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 pb-24 md:px-6 md:pb-10">
            <Suspense fallback={null}>
              <SectionSwipe>{children}</SectionSwipe>
            </Suspense>
          </main>
        </AddExpenseProvider>
      </AuthGate>
    </div>
  );
}
