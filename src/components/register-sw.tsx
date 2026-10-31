"use client";

import { useEffect } from "react";

/**
 * Registers the minimal service worker used by Web Share Target.
 * Safe to mount once in the app shell.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Only register in production / when served over https (or localhost)
    const isSecure =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isSecure) return;

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // Force update check so share_target changes pick up quickly
        void reg.update();
      })
      .catch((err) => {
        console.warn("[sw] register failed", err);
      });
  }, []);

  return null;
}
