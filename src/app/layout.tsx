import type { Metadata, Viewport } from "next";
import { Shell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cuentix", template: "%s · Cuentix" },
  description: "Gastos, ingresos y saldos de una sola persona. Cada moneda va aparte.",
  applicationName: "Cuentix",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-tab.v3.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.v3.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon-180.v2.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#14160f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('cuentix-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
