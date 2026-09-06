import type { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-w-0 flex-1 p-4 lg:p-5">{children}</main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-edge/60 px-4 py-2 lg:px-5">
          <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-faint">
            RAIL RAKSHAK · build 2.1.0 · node NR-DELHI-DIV-03 · latency 12 ms
          </p>
          <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-faint">
            Field-ready prototype · Smart India Hackathon 2026
          </p>
        </footer>
      </div>
    </div>
  );
}
