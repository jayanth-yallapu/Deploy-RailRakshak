"use client";

import { useState, useEffect, useRef } from "react";
import {
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  User,
  Wrench,
  X,
  Upload,
  Play,
} from "lucide-react";

interface Job {
  id: number;
  title: string;
  note: string;
  status: string;
  department: string;
  teamLeader?: string;
  beforePhoto?: string;
  afterPhoto?: string;
  createdAt: string;
  defectId: number;
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

const DEPT_BADGE_COLORS: Record<string, string> = {
  ENG: "bg-blue-500/20 text-blue-400",
  TRD: "bg-purple-500/20 text-purple-400",
  SNT: "bg-green-500/20 text-green-400",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  ALLOTTED: "Allotted",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  SIGNED_OFF: "Signed Off",
  REJECTED: "Rejected",
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<"all" | "ENG" | "TRD" | "SNT">("all");

  // Photo upload states
  const [photoType, setPhotoType] = useState<"before" | "after" | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/jobs");
      if (!res.ok) throw new Error("Failed to fetch jobs");
      const data = await res.json();
      const jobsArray = Array.isArray(data) ? data : data.jobs || [];
      setJobs(jobsArray);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load jobs");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  // Filter jobs by department
  const filteredJobs = jobs.filter((j) => {
    // Don't show signed off or rejected
    if (j.status === "SIGNED_OFF" || j.status === "REJECTED") return false;
    // Filter by department
    if (selectedDept === "all") return true;
    return j.department === selectedDept;
  });

  const handlePhotoSelect = (job: Job, type: "before" | "after") => {
    setSelectedJob(job);
    setPhotoType(type);
    setSelectedFile(null);
    setPhotoPreview(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const uploadPhoto = async () => {
    if (!selectedFile || !selectedJob || !photoType) {
      alert("Please select a photo first.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("photo", selectedFile);
      formData.append("jobId", String(selectedJob.id));
      formData.append("type", photoType);

      const res = await fetch("/api/jobs/photo", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      await fetchJobs();
      setSelectedFile(null);
      setPhotoPreview(null);
      setSelectedJob(null);
      setPhotoType(null);
      alert(`✅ ${photoType === "before" ? "BEFORE" : "AFTER"} photo uploaded successfully!`);
    } catch (err: any) {
      alert(`❌ Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const startJob = async (jobId: number) => {
    try {
      const res = await fetch("/api/jobs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) throw new Error("Failed to start job");
      await fetchJobs();
    } catch (err: any) {
      alert(`❌ ${err.message}`);
    }
  };

  const completeJob = async (jobId: number) => {
    try {
      const res = await fetch("/api/jobs/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) throw new Error("Failed to complete job");
      await fetchJobs();
    } catch (err: any) {
      alert(`❌ ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-abyss flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-amber-500" />
      </div>
    );
  }

  // Count jobs per department
  const deptCounts = {
    ENG: jobs.filter(j => j.department === "ENG" && j.status !== "SIGNED_OFF" && j.status !== "REJECTED").length,
    TRD: jobs.filter(j => j.department === "TRD" && j.status !== "SIGNED_OFF" && j.status !== "REJECTED").length,
    SNT: jobs.filter(j => j.department === "SNT" && j.status !== "SIGNED_OFF" && j.status !== "REJECTED").length,
  };

  return (
    <div className="min-h-screen bg-abyss text-ink p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-amber-400 flex items-center gap-2">
              🔧 My Job Portal
            </h1>
            <p className="text-sm text-dim">Work permits & GPS proof</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1.5 bg-purple-500/20 border border-purple-500/30 rounded-full text-xs font-medium text-purple-400 flex items-center gap-1.5">
              <User size={12} /> Karmi – All Divisions
            </span>
            <button
              onClick={fetchJobs}
              className="text-xs text-dim hover:text-ink transition border border-edge px-3 py-1.5 rounded-lg"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Department Tabs */}
        <div className="flex flex-wrap gap-2 mb-6 border-b border-edge pb-3">
          <button
            onClick={() => setSelectedDept("all")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition flex items-center gap-2 ${
              selectedDept === "all"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "text-dim hover:text-ink"
            }`}
          >
            📋 All
            <span className="text-xs bg-panel px-2 py-0.5 rounded-full">
              {filteredJobs.length}
            </span>
          </button>
          <button
            onClick={() => setSelectedDept("ENG")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition flex items-center gap-2 ${
              selectedDept === "ENG"
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "text-dim hover:text-ink"
            }`}
          >
            🔧 ENG
            <span className="text-xs bg-panel px-2 py-0.5 rounded-full">
              {deptCounts.ENG}
            </span>
          </button>
          <button
            onClick={() => setSelectedDept("TRD")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition flex items-center gap-2 ${
              selectedDept === "TRD"
                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                : "text-dim hover:text-ink"
            }`}
          >
            ⚡ TRD
            <span className="text-xs bg-panel px-2 py-0.5 rounded-full">
              {deptCounts.TRD}
            </span>
          </button>
          <button
            onClick={() => setSelectedDept("SNT")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition flex items-center gap-2 ${
              selectedDept === "SNT"
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "text-dim hover:text-ink"
            }`}
          >
            📡 SNT
            <span className="text-xs bg-panel px-2 py-0.5 rounded-full">
              {deptCounts.SNT}
            </span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Jobs List */}
        {filteredJobs.length === 0 ? (
          <div className="bg-hull border border-edge rounded-lg p-8 text-center text-dim">
            <Wrench size={40} className="mx-auto text-dim/50 mb-3" />
            <p className="text-sm">No jobs assigned for {selectedDept === "all" ? "any" : selectedDept} department.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredJobs.map((job) => (
              <div
                key={job.id}
                className="bg-hull border border-edge rounded-lg p-4 hover:border-amber-500/30 transition"
              >
                <div className="flex flex-col md:flex-row md:items-start gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Department + Status Badges */}
                    <div className="flex items-center flex-wrap gap-2">
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          DEPT_COLORS[job.department] ||
                          "border-gray-500/30 bg-gray-500/10 text-gray-400"
                        }`}
                      >
                        {DEPT_LABELS[job.department] || job.department}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          job.status === "IN_PROGRESS"
                            ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                            : job.status === "COMPLETED"
                            ? "border-green-500/30 bg-green-500/10 text-green-400"
                            : job.status === "ALLOTTED"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                            : "border-gray-500/30 bg-gray-500/10 text-gray-400"
                        }`}
                      >
                        {STATUS_LABELS[job.status] || job.status}
                      </span>
                      {job.teamLeader && (
                        <span className="text-[10px] text-dim flex items-center gap-1">
                          <User size={10} /> {job.teamLeader}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <p className="text-sm font-medium mt-1.5 text-ink">{job.title}</p>

                    {/* Note */}
                    {job.note && <p className="text-xs text-dim mt-0.5">{job.note}</p>}

                    {/* Photo Status */}
                    <div className="flex items-center flex-wrap gap-3 mt-2 text-xs text-dim">
                      {job.beforePhoto && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Camera size={12} /> Before Photo ✓
                        </span>
                      )}
                      {job.afterPhoto && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Camera size={12} /> After Photo ✓
                        </span>
                      )}
                      {!job.beforePhoto && job.status === "IN_PROGRESS" && (
                        <span className="flex items-center gap-1 text-amber-400">
                          <Camera size={12} /> Before photo pending
                        </span>
                      )}
                      {job.beforePhoto && !job.afterPhoto && job.status === "IN_PROGRESS" && (
                        <span className="flex items-center gap-1 text-amber-400">
                          <Camera size={12} /> After photo pending
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {/* ALLOTTED → Start Work */}
                    {job.status === "ALLOTTED" && (
                      <button
                        onClick={() => startJob(job.id)}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-lg transition flex items-center gap-1.5"
                      >
                        <Play size={14} /> Start Work
                      </button>
                    )}

                    {/* IN_PROGRESS → Upload Before/After + Complete */}
                    {job.status === "IN_PROGRESS" && (
                      <>
                        <button
                          onClick={() => handlePhotoSelect(job, "before")}
                          className={`${
                            job.beforePhoto
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : "bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30"
                          } border px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5`}
                        >
                          <Camera size={14} /> {job.beforePhoto ? "✓ Before" : "Before"}
                        </button>

                        <button
                          onClick={() => handlePhotoSelect(job, "after")}
                          className={`${
                            job.afterPhoto
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : "bg-purple-500/20 text-purple-400 border-purple-500/30 hover:bg-purple-500/30"
                          } border px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5`}
                        >
                          <Camera size={14} /> {job.afterPhoto ? "✓ After" : "After"}
                        </button>

                        <button
                          onClick={() => completeJob(job.id)}
                          disabled={!job.beforePhoto || !job.afterPhoto}
                          className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                            job.beforePhoto && job.afterPhoto
                              ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
                              : "bg-gray-500/20 text-gray-400 cursor-not-allowed"
                          }`}
                        >
                          <CheckCircle2 size={14} /> Complete
                        </button>
                      </>
                    )}

                    {/* COMPLETED → Waiting for Sign-Off */}
                    {job.status === "COMPLETED" && (
                      <span className="text-xs text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-4 py-2 rounded-lg border border-emerald-500/30">
                        <CheckCircle2 size={14} /> Awaiting Sign-Off
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Photo Upload Modal */}
      {selectedFile && selectedJob && photoType && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setSelectedFile(null);
            setPhotoPreview(null);
          }}
        >
          <div
            className="bg-hull border border-edge rounded-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-4">
              <Camera size={16} className="text-amber-400" />
              {photoType === "before" ? "BEFORE" : "AFTER"} Repair Photo
            </h3>

            <div className="relative w-full aspect-[4/3] bg-panel rounded-lg overflow-hidden mb-4">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Preview"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-dim">
                  No photo selected
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setPhotoPreview(null);
                }}
                className="flex-1 bg-panel border border-edge hover:bg-edge text-ink text-xs font-semibold py-2.5 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={uploadPhoto}
                disabled={uploading}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold py-2.5 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload Photo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}