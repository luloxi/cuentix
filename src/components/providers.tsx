"use client";

import { ThemeProvider } from "@/components/theme-provider";

/** Better Auth uses its own client. No next-auth SessionProvider. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
