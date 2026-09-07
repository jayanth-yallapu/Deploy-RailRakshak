import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/lib/theme";
import { LangProvider } from "@/lib/lang";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "RAIL RAKSHAK — AI Block Planning for Indian Railways",
  description:
    "Smart block planning for the Delhi NCR rail grid: failure-risk scoring, multi-department scheduling, stress testing, and the full report-to-release field workflow.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${sans.variable} ${mono.variable}`}>
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
