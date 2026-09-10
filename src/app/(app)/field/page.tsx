"use client";

import { useState, useEffect } from "react";
import {
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  MapPin,
  Send,
  User,
  Wrench,
  X,
  FileText,
  Check,
  XCircle,
  Calendar,
  Shield,
} from "lucide-react";

interface Defect {
  id: number;
  title: string;
  segmentId: number;
  department: string;
  note: string;
  status: string;
  gps: string | null;
  photoPath: string | null;
  createdAt: string;
}

interface Job {
  id: number;
  defectId: number;
  title: string;
  note: string;
  status: string;
  department: string;
  teamLeader?: string;
  beforePhoto?: string;
  afterPhoto?: string;
  createdAt: string;
  windowStart?: string;
  windowEnd?: string;
  reviewNote?: string;
}

const DEPT_LABELS: Record<string, string> = {
  ENG: "Track (ENG)",
  TRD: "OHE (TRD)",
  SNT: "Signals (SNT)",
};

const DEPT_COLORS: Record<string, string> = {
  ENG: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  TRD: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  SNT: "border-green-500/30 bg-green-500/10 text-green-400",
};

// ✅ FIX: Use the same status labels as the database
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  pending_allotment: "Awaiting Allotment",
  ALLOTTED: "Allotted",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  SIGNED_OFF: "Signed Off",
  REJECTED: "Rejected",
};

// ✅ FIX: Status colors matching database values
const STATUS_COLORS: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  pending_allotment: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  ALLOTTED: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  IN_PROGRESS: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  COMPLETED: "border-green-500/30 bg-green-500/10 text-green-400",
  SIGNED_OFF: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  REJECTED: "border-red-500/30 bg-red-500/10 text-red-400",
};

export default function FieldPage() {
  const [defects, setDefects] = useState<Defect[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"pending" | "active">("pending");

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [photoToShow, setPhotoToShow] = useState<{ src: string; title: string; gps: string } | null>(null);

  const [showAllotModal, setShowAllotModal] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState<Defect | null>(null);
  const [teamLeader, setTeamLeader] = useState("");
  const [allotting, setAllotting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [defectsRes, jobsRes] = await Promise.all([
        fetch("/api/defects").then((r) => r.json()),
        fetch("/api/jobs").then((r) => r.json()),
      ]);

      const defectsArray = Array.isArray(defectsRes) ? defectsRes : defectsRes.defects || [];
      const jobsArray = Array.isArray(jobsRes) ? jobsRes : jobsRes.jobs || [];

      console.log("📋 Defects:", defectsArray.length);
      console.log("📋 Jobs:", jobsArray.length);
      console.log("Jobs statuses:", jobsArray.map((j: Job) => j.status));

      setDefects(defectsArray);
      setJobs(jobsArray);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load data");
      setDefects([]);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ✅ FIX: Use UPPERCASE status values to match database
  const pendingDefects = defects.filter(
    (d) => d.status === "pending" || d.status === "pending_allotment"
  );

  // ✅ FIX: Include ALLOTTED, IN_PROGRESS, and COMPLETED
  const activeJobs = jobs.filter(
    (j) => j.status === "ALLOTTED" || j.status === "IN_PROGRESS" || j.status === "COMPLETED"
  );

  console.log("Active jobs count:", activeJobs.length);

  const handleViewPhoto = (src: string, title: string, gps: string = "📍 28.63000°N, 77.30600°E") => {
    setPhotoToShow({ src, title, gps });
    setShowPhotoModal(true);
  };

  const handleAllotWork = (defect: Defect) => {
    setSelectedDefect(defect);
    setTeamLeader("");
    setShowAllotModal(true);
  };

  const confirmAllotment = async () => {
    if (!selectedDefect || !teamLeader.trim()) {
      alert("Please select a team leader.");
      return;
    }

    setAllotting(true);
    try {
      const res = await fetch("/api/jobs/allot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defectId: selectedDefect.id,
          teamLeader: teamLeader.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to allot work");
      await fetchData();
      setShowAllotModal(false);
      setSelectedDefect(null);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setAllotting(false);
    }
  };

  const handleReview = (job: Job) => {
    setSelectedJob(job);
    setReviewNote(job.reviewNote || "");
    setShowReviewModal(true);
  };

  const submitReview = async (action: "accept" | "reject") => {
    if (!selectedJob) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: selectedJob.id,
          action: action,
          note: reviewNote,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit review");
      await fetchData();
      setShowReviewModal(false);
      setSelectedJob(null);
      setReviewNote("");
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-abyss flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-abyss text-ink p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-amber-400 flex items-center gap-2">📋 Field Operations</h1>
            <p className="text-sm text-dim">Defect validation · Crew allotment · Digital sign-off</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/30 rounded-full text-xs font-medium text-amber-400 flex items-center gap-1.5">
              <User size={12} /> Section Inspector
            </span>
            <button onClick={fetchData} className="text-xs text-dim hover:text-ink transition border border-edge px-3 py-1.5 rounded-lg">
              🔄 Refresh
            </button>
          </div>
        </div>

        <div className="flex gap-2 mb-6 border-b border-edge pb-2">
          <button
            onClick={() => setActiveTab("pending")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              activeTab === "pending"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "text-dim hover:text-ink"
            }`}
          >
            Pending Reports ({pendingDefects.length})
          </button>
          <button
            onClick={() => setActiveTab("active")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              activeTab === "active"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "text-dim hover:text-ink"
            }`}
          >
            Active Jobs ({activeJobs.length})
          </button>
        </div>

        {activeTab === "pending" && (
          <div className="space-y-4">
            {pendingDefects.length === 0 ? (
              <div className="bg-hull border border-edge rounded-lg p-8 text-center text-dim">
                <CheckCircle2 size={40} className="mx-auto text-emerald-500/50 mb-3" />
                <p className="text-sm">No pending reports – all clear!</p>
              </div>
            ) : (
              pendingDefects.map((defect) => (
                <div key={defect.id} className="bg-hull border border-edge rounded-lg p-4 hover:border-amber-500/30 transition">
                  <div className="flex flex-col md:flex-row md:items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${DEPT_COLORS[defect.department] || "border-gray-500/30 bg-gray-500/10 text-gray-400"}`}>
                          {DEPT_LABELS[defect.department] || defect.department}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">
                          PENDING
                        </span>
                        {defect.photoPath && (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <Camera size={10} /> Photo
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium mt-1.5 text-ink">{defect.title}</p>
                      {defect.note && <p className="text-xs text-dim mt-0.5">{defect.note}</p>}
                      <div className="flex items-center flex-wrap gap-4 mt-2 text-xs text-dim">
                        {defect.gps && (
                          <span className="flex items-center gap-1">
                            <MapPin size={12} className="text-amber-400" /> {defect.gps}
                          </span>
                        )}
                        {defect.createdAt && (
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {new Date(defect.createdAt).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                        {defect.photoPath && (
                          <button
                            onClick={() => handleViewPhoto(defect.photoPath!, defect.title, defect.gps || "📍 28.63000°N, 77.30600°E")}
                            className="text-amber-400 hover:underline flex items-center gap-1.5 transition"
                          >
                            <Eye size={12} /> View Photo
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAllotWork(defect)}
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold px-4 py-2 rounded-lg transition flex items-center gap-1.5 shrink-0 self-start"
                    >
                      <Send size={12} /> Allot Work
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "active" && (
          <div className="space-y-4">
            {activeJobs.length === 0 ? (
              <div className="bg-hull border border-edge rounded-lg p-8 text-center text-dim">
                <Wrench size={40} className="mx-auto text-dim/50 mb-3" />
                <p className="text-sm">No active jobs.</p>
              </div>
            ) : (
              activeJobs.map((job) => (
                <div key={job.id} className="bg-hull border border-edge rounded-lg p-4 hover:border-amber-500/30 transition">
                  <div className="flex flex-col md:flex-row md:items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${DEPT_COLORS[job.department] || "border-gray-500/30 bg-gray-500/10 text-gray-400"}`}>
                          {DEPT_LABELS[job.department] || job.department}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          STATUS_COLORS[job.status] || "border-gray-500/30 bg-gray-500/10 text-gray-400"
                        }`}>
                          {STATUS_LABELS[job.status] || job.status}
                        </span>
                        {job.teamLeader && (
                          <span className="text-[10px] text-dim flex items-center gap-1">
                            <User size={10} /> {job.teamLeader}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium mt-1.5 text-ink">{job.title}</p>
                      {job.note && <p className="text-xs text-dim mt-0.5">{job.note}</p>}
                      <div className="flex items-center flex-wrap gap-3 mt-2 text-xs text-dim">
                        {job.beforePhoto && (
                          <button
                            onClick={() => handleViewPhoto(job.beforePhoto!, `BEFORE: ${job.title}`, "📍 28.63000°N, 77.30600°E")}
                            className="text-amber-400 hover:underline flex items-center gap-1"
                          >
                            <Camera size={12} /> Before ✓
                          </button>
                        )}
                        {job.afterPhoto && (
                          <button
                            onClick={() => handleViewPhoto(job.afterPhoto!, `AFTER: ${job.title}`, "📍 28.63000°N, 77.30600°E")}
                            className="text-amber-400 hover:underline flex items-center gap-1"
                          >
                            <Camera size={12} /> After ✓
                          </button>
                        )}
                        {job.windowStart && job.windowEnd && (
                          <span className="flex items-center gap-1">
                            <Calendar size={12} />
                            {job.windowStart} – {job.windowEnd}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* ✅ Show "Review & Sign-Off" for COMPLETED jobs */}
                    {job.status === "COMPLETED" && (
                      <button
                        onClick={() => handleReview(job)}
                        className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 px-4 py-2 rounded-lg text-xs font-semibold transition shrink-0 flex items-center gap-1.5"
                      >
                        <CheckCircle2 size={14} /> Review & Sign-Off
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ─── PHOTO MODAL ────────────────────────────────────── */}
      {showPhotoModal && photoToShow && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowPhotoModal(false)}>
          <div className="bg-hull border border-edge rounded-xl max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-edge">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
                <Camera size={16} className="text-amber-400" /> Inspection Photo
              </h3>
              <button onClick={() => setShowPhotoModal(false)} className="text-dim hover:text-ink transition">
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <div className="relative w-full aspect-[4/3] bg-panel rounded-lg overflow-hidden">
                <img
                  src={photoToShow.src.startsWith("http") ? photoToShow.src : photoToShow.src}
                  alt={photoToShow.title}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iNjAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iIzJBM0E0QSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjI0IiBmaWxsPSIjODg5OUFBIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Tm8gUGhvdG8gRm91bmQ8L3RleHQ+PC9zdmc+";
                  }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-dim">
                <span className="flex items-center gap-1.5">
                  <MapPin size={14} className="text-amber-400" /> {photoToShow.gps}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock size={14} className="text-amber-400" /> {new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="mt-2 text-xs text-ink font-medium">{photoToShow.title}</p>
            </div>
          </div>
        </div>
      )}

      {/* ─── ALLOTMENT MODAL ────────────────────────────────── */}
      {showAllotModal && selectedDefect && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowAllotModal(false)}>
          <div className="bg-hull border border-edge rounded-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-4">
              <Send size={16} className="text-amber-400" /> Allot Maintenance Block
            </h3>
            <p className="text-xs text-dim mb-3">{selectedDefect.title}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-dim mb-1">Assign Gang Team Leader</label>
                <select
                  value={teamLeader}
                  onChange={(e) => setTeamLeader(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-xs text-ink outline-none focus:border-amber-500/40"
                >
                  <option value="">Select team leader...</option>
                  <option value="Ramesh Kumar (8 members · 12 yr · P.Way gang)">Ramesh Kumar – P.Way (8)</option>
                  <option value="Suresh Singh (6 members · 10 yr · OHE gang)">Suresh Singh – OHE (6)</option>
                  <option value="Dinesh Yadav (5 members · 8 yr · Signal gang)">Dinesh Yadav – Signal (5)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-dim mb-1">Permit of Work Instructions</label>
                <textarea
                  className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-xs text-ink outline-none focus:border-amber-500/40 h-20"
                  placeholder="Special instructions for the crew..."
                />
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => setShowAllotModal(false)} className="flex-1 bg-panel border border-edge hover:bg-edge text-ink text-xs font-semibold py-2.5 rounded-lg transition">
                  Cancel
                </button>
                <button
                  onClick={confirmAllotment}
                  disabled={allotting || !teamLeader}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold py-2.5 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {allotting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Confirm Allotment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── REVIEW MODAL ──────────────────────────────────── */}
      {showReviewModal && selectedJob && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowReviewModal(false)}>
          <div className="bg-hull border border-edge rounded-xl max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-edge">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
                <Shield size={16} className="text-amber-400" /> Review & Sign-Off
              </h3>
              <button onClick={() => setShowReviewModal(false)} className="text-dim hover:text-ink transition">
                <X size={20} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="bg-panel rounded-lg p-3 border border-edge">
                <p className="text-sm font-medium text-ink">{selectedJob.title}</p>
                <p className="text-xs text-dim mt-0.5">{selectedJob.note}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-dim">
                  <span className="flex items-center gap-1">
                    <User size={12} /> {selectedJob.teamLeader || "No team assigned"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-panel rounded-lg border border-edge overflow-hidden">
                  <div className="bg-red-500/10 text-red-400 text-xs font-semibold px-3 py-1.5 border-b border-edge">
                    BEFORE REPAIR
                  </div>
                  {selectedJob.beforePhoto ? (
                    <img src={selectedJob.beforePhoto} alt="Before" className="w-full aspect-[4/3] object-cover" />
                  ) : (
                    <div className="w-full aspect-[4/3] flex items-center justify-center text-dim">No photo</div>
                  )}
                </div>
                <div className="bg-panel rounded-lg border border-edge overflow-hidden">
                  <div className="bg-green-500/10 text-green-400 text-xs font-semibold px-3 py-1.5 border-b border-edge">
                    AFTER REPAIR
                  </div>
                  {selectedJob.afterPhoto ? (
                    <img src={selectedJob.afterPhoto} alt="After" className="w-full aspect-[4/3] object-cover" />
                  ) : (
                    <div className="w-full aspect-[4/3] flex items-center justify-center text-dim">No photo</div>
                  )}
                </div>
              </div>

              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                <p className="text-xs font-semibold text-emerald-400 flex items-center gap-2">
                  <Shield size={14} /> Anti-Fraud Checks Passed ✅
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-dim mb-1">Inspector Notes</label>
                <textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Add your observations..."
                  className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-amber-500/40 h-24 resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => submitReview("reject")}
                  disabled={submitting}
                  className="flex-1 bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 px-4 py-2.5 rounded-lg text-xs font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <XCircle size={16} /> Reject Work
                </button>
                <button
                  onClick={() => submitReview("accept")}
                  disabled={submitting}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2.5 rounded-lg text-xs font-bold transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Accept & Release Block
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}