import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const space = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
});

const jb = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jb",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RAIL RAKSHAK — AI Block Planning for Indian Railways",
  description:
    "Data-driven block planning for the Delhi NCR rail grid: trained failure-risk scoring, constraint-based super-block scheduling, Monte Carlo validation, and the full report-to-release field workflow.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${space.variable} ${jb.variable}`}>
      <body>{children}</body>
    </html>
  );
}
