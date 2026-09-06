"use client";

import { useState } from "react";
import { CameraOff } from "lucide-react";

/** Photo with a graceful fallback — never shows a broken-image icon in the field workflow. */
export default function SmartImg({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className={`flex items-center justify-center bg-edge/40 ${className ?? ""}`} role="img" aria-label={alt}>
        <span className="flex flex-col items-center gap-1 p-1 text-faint">
          <CameraOff size={13} />
          <span className="font-mono text-[7px] uppercase tracking-wider">photo offline</span>
        </span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setErr(true)} />;
}
