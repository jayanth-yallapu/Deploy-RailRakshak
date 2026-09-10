"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  MapPin,
  Satellite,
  TrainFront,
  Wifi,
  WifiOff,
  AlertCircle,
} from "lucide-react";
import { SEGMENTS, INSPECTOR_ZONE, sectionMeta } from "@/lib/engine/network";

// ─── Defect presets ──────────────────────────────────────────────
const PRESETS = [
  { title: "Rail head crack / spalling", dept: "ENG" },
  { title: "Broken elastic rail clip", dept: "ENG" },
  { title: "OHE drooping / catenary sag", dept: "TRD" },
  { title: "Insulator crack on mast", dept: "TRD" },
  { title: "Signal lamp not lit", dept: "SNT" },
  { title: "Point machine straining", dept: "SNT" },
  { title: "Other (Custom defect)", dept: "OTHER" },
];

// ─── Main component ──────────────────────────────────────────────
export default function PatrolPage() {
  // ── Navigation ──────────────────────────────────────────────────
  const zoneSegs = SEGMENTS.filter((s) =>
    INSPECTOR_ZONE.sections.includes(s.code)
  );
  const [presetIdx, setPresetIdx] = useState(0);
  const [segIdx, setSegIdx] = useState(1);
  const [note, setNote] = useState("");

  // ── GPS ─────────────────────────────────────────────────────────
  const [gps, setGps] = useState("--.--°N, --.--°E");
  const [satLock, setSatLock] = useState(false);
  const [gpsAcquiring, setGpsAcquiring] = useState(false);

  // ── Photo ──────────────────────────────────────────────────────
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── "Other" category ──────────────────────────────────────────
  const [customDefect, setCustomDefect] = useState("");
  // What the patroller saw, not what the system assumes: the seeded queue used to receive every
  // handset report as "medium" severity, which flattened a rail-head crack into a paint complaint.
  const [severity, setSeverity] = useState("medium");
  const [customDept, setCustomDept] = useState<"ENG" | "TRD" | "SNT">("ENG");
  const [showCustom, setShowCustom] = useState(false);

  // ── UI state ──────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    type: "info" | "success" | "error" | "";
    message: string;
  }>({ type: "", message: "" });

  // ── Offline simulation ─────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ── Derived data ──────────────────────────────────────────────
  const seg = zoneSegs[segIdx] || zoneSegs[0];
  const preset = PRESETS[presetIdx] || PRESETS[0];
  const meta = sectionMeta(seg?.code);
  const selectedDefect =
    preset.dept === "OTHER" ? customDefect.trim() : preset.title;
  const selectedDept = preset.dept === "OTHER" ? customDept : preset.dept;

  // ── Handlers ──────────────────────────────────────────────────

  // GPS acquisition
  function acquireGps() {
    if (gpsAcquiring) return;
    setGpsAcquiring(true);
    setSatLock(false);
    setUploadStatus({ type: "info", message: "🛰️ Acquiring GPS signal..." });

    // Simulate GPS acquisition (2 seconds)
    setTimeout(() => {
      const pt = seg?.geo?.[Math.floor(seg.geo.length / 2)] || [28.61, 77.23];
      setGps(`${pt[0].toFixed(5)}°N, ${pt[1].toFixed(5)}°E`);
      setSatLock(true);
      setGpsAcquiring(false);
      setUploadStatus({ type: "success", message: "✅ GPS locked successfully!" });
    }, 1800);
  }

  // File selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setUploadStatus({ type: "error", message: "❌ Please select an image file." });
      return;
    }

    // Validate size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadStatus({ type: "error", message: "❌ File too large (max 10MB)." });
      return;
    }

    setSelectedPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoName(file.name);
    setUploadStatus({ type: "success", message: `📸 Selected: ${file.name}` });
  };

  // Open file picker
  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // Submit report
  async function submitReport() {
    // Validations
    if (!selectedPhoto) {
      setUploadStatus({ type: "error", message: "❌ Please select a photo first!" });
      return;
    }

    if (preset.dept === "OTHER" && !customDefect.trim()) {
      setUploadStatus({ type: "error", message: "❌ Please describe the custom defect!" });
      return;
    }

    if (!satLock) {
      setUploadStatus({ type: "error", message: "❌ Please acquire GPS lock first!" });
      return;
    }

    setBusy(true);
    setUploadStatus({ type: "info", message: "📤 Uploading report..." });

    try {
      // Convert photo to base64
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(selectedPhoto);
      });

      // Get segment ID from state API
      const stateRes = await fetch("/api/state");
      if (!stateRes.ok) throw new Error("Failed to fetch segment data");
      const stateData = await stateRes.json();
      const target = stateData.segments?.find(
        (s: any) => s.code === seg.code
      );
      if (!target) throw new Error(`Segment ${seg.code} not found`);

      // Build defect title
      const defectTitle =
        preset.dept === "OTHER"
          ? `${customDefect.trim()} — ${seg.code}`
          : `${preset.title} — ${seg.code}`;

      // Send report
      const res = await fetch("/api/jobs/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: defectTitle,
          segmentId: target.id,
          department: selectedDept,
          note: note.trim() || `Patroller on-foot report, ${meta?.chainage ?? seg.code}`,
          severity,
          photoData: base64Data,
          gps: gps,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Server error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      setSent(data.id ?? 1);
      setUploadStatus({
        type: "success",
        message: `✅ Report #${data.id} transmitted successfully!`,
      });
      // Reset photo selection
      setSelectedPhoto(null);
      setPhotoPreview(null);
      setPhotoName("");
      setCustomDefect("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error: any) {
      console.error("Upload error:", error);
      setUploadStatus({ type: "error", message: `❌ ${error.message}` });
    } finally {
      setBusy(false);
    }
  }

  // Reset form after success
  const resetForm = () => {
    setSent(null);
    setSelectedPhoto(null);
    setPhotoPreview(null);
    setPhotoName("");
    setUploadStatus({ type: "", message: "" });
    setCustomDefect("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="relative flex min-h-screen items-center justify-center gap-12 bg-[#0A0E17] p-6">
      {/* Background grid effect */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCI+PHBhdGggZD0iTTYwIDBMMCA2MCIgc3Ryb2tlPSIjMjUyYzRjIiBzdHJva2Utd2lkdGg9IjAuNSIgb3BhY2l0eT0iMC4zIi8+PC9zdmc+')] opacity-30" />

      {/* ─── PHONE FRAME ───────────────────────────────────────── */}
      <div className="relative z-10 w-[340px] shrink-0 rounded-[2.8rem] border-[8px] border-[#1c2638] bg-[#0c121e] p-3 shadow-2xl shadow-cyan-950/20">
        {/* Notch */}
        <div className="mx-auto mb-2 h-4 w-24 rounded-b-xl bg-[#1c2638]" />

        <div className="rounded-[2rem] border border-[#2A3A4A]/80 bg-[#131A26] p-4">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#2A3A4A]/60 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
                <TrainFront size={16} />
              </span>
              <div>
                <p className="text-xs font-bold text-[#E8EDF5]">RAKSHAK PATROL</p>
                <p className="text-[10px] text-[#8899AA]">Patroller Field Handset v2.1</p>
              </div>
            </div>
            {/* Online/Offline indicator */}
            <div className="flex items-center gap-1.5">
              {isOnline ? (
                <Wifi size={12} className="text-emerald-400" />
              ) : (
                <WifiOff size={12} className="text-red-400" />
              )}
              <span className={`text-[8px] font-mono ${isOnline ? "text-emerald-400" : "text-red-400"}`}>
                {isOnline ? "ONLINE" : "OFFLINE"}
              </span>
              <span className="anim-blink h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </div>
          </div>

          {/* ─── SCROLLABLE CONTENT ────────────────────────────── */}
          <div className="mt-3 space-y-3 max-h-[480px] overflow-y-auto pr-1 custom-scrollbar">
            {/* Defect Type */}
            <div>
              <label className="block text-[11px] font-semibold text-[#8899AA]">
                Observed Defect Type
              </label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {PRESETS.map((p, i) => (
                  <button
                    key={p.title}
                    type="button"
                    onClick={() => {
                      setPresetIdx(i);
                      setShowCustom(p.dept === "OTHER");
                      if (p.dept !== "OTHER") setCustomDefect("");
                    }}
                    className={`rounded-lg border p-2 text-left transition ${
                      presetIdx === i
                        ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                        : "border-[#2A3A4A] bg-[#0A0E17]/50 text-[#8899AA] hover:text-[#E8EDF5]"
                    }`}
                  >
                    <span className="block text-[10.5px] font-semibold leading-tight">
                      {p.title}
                    </span>
                    <span className="mt-0.5 block text-[9.5px] font-mono text-faint">
                      {p.dept}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Gravity observed */}
            <div>
              <label className="block text-[11px] font-semibold text-[#8899AA]">
                Gravity As Observed
              </label>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {[
                  { k: "low", t: "LOW" },
                  { k: "medium", t: "MED" },
                  { k: "high", t: "HIGH" },
                  { k: "critical", t: "CRIT" },
                ].map((o) => (
                  <button
                    key={o.k}
                    type="button"
                    onClick={() => setSeverity(o.k)}
                    className={`rounded-lg border p-1.5 text-center text-[10.5px] font-semibold transition ${
                      severity === o.k
                        ? o.k === "critical"
                          ? "border-rose-500/60 bg-rose-500/15 text-rose-300"
                          : "border-amber-500/60 bg-amber-500/15 text-amber-300"
                        : "border-[#2A3A4A] bg-[#0A0E17]/50 text-[#8899AA] hover:text-[#E8EDF5]"
                    }`}
                  >
                    {o.t}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[9.5px] leading-snug text-faint">
                Feeds the 72-hour risk model with overdue days + asset health; the planner ranks on
                that, so tap what you actually see.
              </p>
            </div>

            {/* Custom Defect (shown when "Other" selected) */}
            {showCustom && (
              <div className="space-y-2 border border-amber-500/30 rounded-lg bg-amber-500/5 p-3">
                <label className="block text-[11px] font-semibold text-amber-400">
                  ✏️ Custom Defect Description
                </label>
                <input
                  value={customDefect}
                  onChange={(e) => setCustomDefect(e.target.value)}
                  placeholder="e.g. Broken fishplate, loose fastening..."
                  className="w-full rounded-lg border border-[#2A3A4A] bg-[#0A0E17] px-3 py-2 text-xs text-[#E8EDF5] placeholder:text-[#8899AA] focus:border-amber-500/40 focus:outline-none"
                />
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-[#8899AA]">
                    <input
                      type="radio"
                      name="customDept"
                      value="ENG"
                      checked={customDept === "ENG"}
                      onChange={() => setCustomDept("ENG")}
                      className="accent-amber-500"
                    />
                    ENG
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[#8899AA]">
                    <input
                      type="radio"
                      name="customDept"
                      value="TRD"
                      checked={customDept === "TRD"}
                      onChange={() => setCustomDept("TRD")}
                      className="accent-amber-500"
                    />
                    TRD
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[#8899AA]">
                    <input
                      type="radio"
                      name="customDept"
                      value="SNT"
                      checked={customDept === "SNT"}
                      onChange={() => setCustomDept("SNT")}
                      className="accent-amber-500"
                    />
                    SNT
                  </label>
                </div>
              </div>
            )}

            {/* Track Section */}
            <div>
              <label className="block text-[11px] font-semibold text-[#8899AA]">
                Track Section
              </label>
              <select
                value={segIdx}
                onChange={(e) => setSegIdx(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-[#2A3A4A] bg-[#0A0E17] px-3 py-2 text-xs font-medium text-[#E8EDF5] outline-none focus:border-amber-500/40"
              >
                {zoneSegs.map((s, i) => (
                  <option key={s.code} value={i}>
                    {s.code} · {s.corridor}
                  </option>
                ))}
              </select>
            </div>

            {/* GPS Acquisition */}
            <div>
              <button
                onClick={acquireGps}
                disabled={gpsAcquiring || busy}
                className={`flex w-full items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-semibold transition ${
                  satLock
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : gpsAcquiring
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-[#2A3A4A] bg-[#0A0E17] text-[#8899AA] hover:text-[#E8EDF5]"
                } disabled:opacity-50`}
              >
                {gpsAcquiring ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : satLock ? (
                  <CheckCircle2 size={14} className="text-emerald-400" />
                ) : (
                  <Satellite size={14} />
                )}
                {gpsAcquiring
                  ? "Acquiring..."
                  : satLock
                  ? `📍 ${gps}`
                  : "Acquire GPS Satellite Lock"}
              </button>
              {satLock && (
                <p className="mt-0.5 text-[9px] text-emerald-400/70 font-mono">
                  ✅ GPS locked – {gps}
                </p>
              )}
            </div>

            {/* Observation Note */}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Observation note (e.g. ~9mm fracture, location details)..."
              className="w-full rounded-xl border border-[#2A3A4A] bg-[#0A0E17] px-3 py-2 text-xs text-[#E8EDF5] placeholder:text-[#8899AA] focus:border-amber-500/40 focus:outline-none"
            />

            {/* Photo Preview */}
            <div className="overflow-hidden rounded-xl border border-[#2A3A4A] bg-black/40">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Selected defect"
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="aspect-[4/3] flex flex-col items-center justify-center bg-[#0A0E17]/20 text-[#8899AA] text-xs">
                  <Camera size={28} className="mb-2 opacity-40" />
                  <span>Tap &quot;Select Photo&quot; below</span>
                </div>
              )}
              <div className="flex items-center justify-between bg-[#131A26] px-3 py-1.5 text-[10px] text-[#8899AA]">
                <span className="flex items-center gap-1.5">
                  <MapPin size={10} className="text-amber-400" />
                  EXIF GPS & Timestamp Auto‑Embedded
                </span>
                {photoName && (
                  <span className="truncate max-w-[120px] text-[9px] text-faint">
                    {photoName}
                  </span>
                )}
              </div>
            </div>

            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />

            {/* Status message */}
            {uploadStatus.message && (
              <div
                className={`rounded-lg px-3 py-2 text-xs font-mono ${
                  uploadStatus.type === "success"
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : uploadStatus.type === "error"
                    ? "border border-red-500/30 bg-red-500/10 text-red-400"
                    : uploadStatus.type === "info"
                    ? "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "text-[#8899AA]"
                }`}
              >
                {uploadStatus.message}
              </div>
            )}

            {/* ─── ACTION BUTTONS ───────────────────────────────── */}
            {sent ? (
              // Success state
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
                <CheckCircle2 size={24} className="mx-auto text-emerald-400" />
                <p className="mt-1 text-sm font-bold text-emerald-300">
                  Report #{sent} Transmitted
                </p>
                <p className="mt-0.5 text-[10.5px] text-[#8899AA]">
                  Appears in Section Inspector&apos;s Pending Validation
                </p>
                <button
                  onClick={resetForm}
                  className="mt-3 text-xs font-semibold text-amber-400 hover:underline"
                >
                  Report another defect →
                </button>
              </div>
            ) : (
              // Action buttons
              <div className="flex gap-2">
                <button
                  onClick={openFilePicker}
                  disabled={busy}
                  className="flex-1 bg-[#2A3A4A] hover:bg-[#3A4A5A] text-[#E8EDF5] font-bold py-2.5 rounded-xl text-xs transition disabled:opacity-50"
                >
                  📸 Select Photo
                </button>
                <button
                  onClick={submitReport}
                  disabled={busy || !selectedPhoto || !satLock}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 text-xs font-bold transition ${
                    busy || !selectedPhoto || !satLock
                      ? "bg-[#2A3A4A] text-[#8899AA] cursor-not-allowed"
                      : "bg-amber-500 text-slate-950 hover:bg-amber-400"
                  }`}
                >
                  {busy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Camera size={14} />
                  )}
                  {busy ? "Sending..." : "📤 Submit Report"}
                </button>
              </div>
            )}

            {/* Helper text */}
            {!sent && (
              <p className="text-[9px] text-center text-[#8899AA]">
                {!selectedPhoto
                  ? "① Select a photo ② Acquire GPS ③ Submit"
                  : !satLock
                  ? "① Acquire GPS lock ② Submit"
                  : "✅ Ready to submit"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─── SIDE DESCRIPTION ───────────────────────────────────── */}
      <div className="relative z-10 hidden max-w-sm lg:block">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8899AA] hover:text-[#E8EDF5] transition"
        >
          <ChevronLeft size={14} /> Back to Desk Selection
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-[#E8EDF5]">
          The Track Patroller&apos;s Handset
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[#8899AA]">
          Every gangman and keyman carries Rakshak Patrol. A single photo capture
          locks GPS coordinates, derives exact chainage, and routes the ticket
          directly to the Section Inspector in under a second.
        </p>

        <div className="mt-6 space-y-2.5 rounded-2xl border border-[#2A3A4A] bg-[#131A26]/50 p-4 text-xs text-[#8899AA]">
          <p className="font-semibold text-[#E8EDF5]">Key Features:</p>
          <ul className="space-y-1.5 text-[11px] leading-relaxed">
            <li>▸ Offline-first architecture for tunnels and remote cuttings</li>
            <li>▸ Automatic nearest-track GPS chainage calculation</li>
            <li>▸ Cryptographic EXIF photo stamp prevents fraudulent reporting</li>
            <li>▸ Direct real-time feed into the AI optimization backlog</li>
          </ul>
        </div>

        {/* Department legend */}
        <div className="mt-4 flex gap-3 text-[10px] text-[#8899AA]">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            ENG – Track
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-purple-500" />
            TRD – OHE
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            SNT – Signals
          </span>
        </div>
      </div>

      {/* ─── SCROLLBAR STYLES ──────────────────────────────────── */}
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #2A3A4A;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3A4A5A;
        }
      `}</style>
    </div>
  );
}