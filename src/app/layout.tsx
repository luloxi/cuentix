import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cuentix",
  applicationName: "Cuentix",
  description:
    "Importá gastos de tarjeta, fotografiá tickets y compartí el balance con tu grupo.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Cuentix",
    description:
      "Importá gastos de tarjeta, fotografiá tickets y compartí el balance con tu grupo.",
    siteName: "Cuentix",
    type: "website",
  },
  icons: {
    icon: [
      { url: "/icons/favicon.v2.ico", sizes: "any" },
      { url: "/favicon-tab.v2.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.v2.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/icons/favicon.v2.ico"],
  },
  appleWebApp: {
    capable: true,
    title: "Cuentix",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f3ea" },
    { media: "(prefers-color-scheme: dark)", color: "#141210" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

const themeBootScript = `
(function(){
  try {
    var t = localStorage.getItem('lc-theme');
    var dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-AR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="icon" href="/icons/favicon.v2.ico" sizes="any" />
        <link rel="icon" href="/favicon-tab.v2.svg" type="image/svg+xml" />
        <link rel="icon" href="/icons/favicon-32.v2.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png" sizes="180x180" />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
