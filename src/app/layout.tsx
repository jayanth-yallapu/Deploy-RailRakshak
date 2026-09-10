import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/lib/theme";
import { LangProvider } from "@/lib/lang";
import "./globals.css";

// Fonts are self-hosted from /public/fonts via globals.css — no build-time network dependency.
export const metadata: Metadata = {
  title: "RAIL RAKSHAK — AI Block Planning for Indian Railways",
  description:
    "Smart block planning for the Delhi NCR rail grid: failure-risk scoring, multi-department scheduling, stress testing, and the full report-to-release field workflow.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className="antialiased selection:bg-blue-500/20 selection:text-blue-900 dark:selection:bg-blue-400/25 dark:selection:text-blue-200">
        <ThemeProvider>
          <LangProvider>
            {children}
          </LangProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
