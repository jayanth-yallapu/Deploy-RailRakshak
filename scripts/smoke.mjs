#!/usr/bin/env node
/**
 * RAIL RAKSHAK — page & endpoint smoke test.
 *
 * Purpose: catch the "I fixed X and broke Y" regression class. verify.mjs checks business
 * invariants; this checks that every route still renders and every endpoint still returns a
 * well-shaped payload. Run against a live deployment:
 *
 *   node scripts/smoke.mjs [baseUrl]        (default http://localhost:3000)
 *
 * Exit code = number of failures, so it is CI-friendly.
 */
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

let pass = 0;
const failures = [];

const fail = (name, detail) => {
  failures.push(`${name} — ${detail}`);
  console.log(`  ✘ ${name} — ${detail}`);
};
const ok = (name, detail = "") => {
  pass++;
  console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ""}`);
};

/**
 * HTML markers that only appear when something genuinely failed.
 * NB: "This page could not be found" is deliberately NOT here — Next dev embeds a not-found
 * template in the RSC flight payload of every page, so matching it produces false positives.
 * A real 404 is caught by the status check instead.
 */
const BAD_HTML = [
  "Internal Server Error",
  "Application error: a client-side exception",
  "Unhandled Runtime Error",
  "Build Error",
  "Failed to compile",
  "TypeError:",
  "SyntaxError:",
  "Cannot read properties of undefined",
];

/**
 * `shell` = the app chrome every /page under (app) renders; `expect` = a string unique enough to
 * prove this page's own component tree rendered (not just the root layout). Without these the
 * test passes on an empty page shell, which is exactly how the "fixed one thing, blanked another"
 * regression hides.
 */
const SHELL = "RAIL RAKSHAK";
const PAGES = [
  { path: "/", name: "landing / overview", expect: ["26027", "Command Center"] },
  { path: "/login", name: "role sign-in", expect: ["Select Your Operating Desk"] },
  { path: "/command", name: "command center", expect: [SHELL], shell: true },
  // These three used to be `shell: true` (i.e. "we could not find a stable marker, so just check the
  // layout"). Each now has real ones, so a page that renders only its header — or loses a panel to a
  // crash boundary — fails the smoke gate instead of passing it.
  { path: "/planner", name: "block planner", expect: ["Strategic Block Optimization Engine", "Block rule book", "Incremental re-plan"] },
  { path: "/simulation", name: "testing lab", expect: ["Evidence", "divisional allocation meeting"] },
  { path: "/field", name: "field work", expect: [SHELL], shell: true },
  { path: "/jobs", name: "karmi job portal", expect: [SHELL], shell: true },
  { path: "/patrol", name: "patroller reporting", expect: ["Patroller Field Handset", "Observed Defect Type", "Gravity As Observed"] },
];

/** Endpoints that must answer with JSON (GET only; POSTs are exercised by verify.mjs). */
const APIS = [
  { path: "/api/health", name: "health", need: (j) => typeof j === "object" && j !== null },
  { path: "/api/state", name: "state", needKeys: ["stations", "segments", "kpis", "modelCard", "liveTrains"] },
  { path: "/api/defects", name: "defects", needKeys: ["defects", "count"], needList: "defects" },
  { path: "/api/jobs", name: "jobs", needKeys: ["jobs", "count"], needList: "jobs" },
  { path: "/api/ingest?system=TMS", name: "ingest TMS", needKeys: ["contractVersion", "records"] },
  // Read-only: GET must give the plan chain without creating or touching any plan.
  { path: "/api/replan", name: "re-plan chain", needKeys: ["chain", "planId", "diff"] },
];

async function getPage(p) {
  const r = await fetch(base + p, { headers: { "user-agent": "smoke/1.0" } });
  const body = await r.text();
  return { status: r.status, body };
}

console.log(`\nRAIL RAKSHAK smoke test → ${base}\n`);
console.log("Pages (must render real HTML, no framework error shell):");
for (const { path, name, expect, shell } of PAGES) {
  try {
    const { status, body } = await getPage(path);
    if (status === 404) fail(`page ${path} (${name})`, "404 — route missing (renamed/deleted page directory?)");
    else if (status !== 200) fail(`page ${path} (${name})`, `HTTP ${status}`);
    else {
      const bad = BAD_HTML.find((m) => body.includes(m));
      const need = [...(expect ?? []), ...(shell ? ["Block Orchestration System"] : [])];
      const missing = need.filter((m) => !body.includes(m));
      if (bad) fail(`page ${path} (${name})`, `HTML contains "${bad}"`);
      else if (missing.length) fail(`page ${path} (${name})`, `page content missing: ${missing.join(", ")} — component tree did not render`);
      else if (body.length < 800) fail(`page ${path} (${name})`, `suspiciously small HTML (${body.length} bytes)`);
      else ok(`page ${path} (${name})`, `${(body.length / 1024).toFixed(0)} kB`);
    }
  } catch (e) {
    fail(`page ${path} (${name})`, e.message);
  }
}

console.log("\nEndpoints (must return shaped JSON, no undefined-only rows):");
for (const a of APIS) {
  try {
    const r = await fetch(base + a.path);
    const ct = r.headers.get("content-type") ?? "";
    if (r.status !== 200) { fail(`api ${a.path}`, `HTTP ${r.status}`); continue; }
    if (!ct.includes("json")) { fail(`api ${a.path}`, `content-type "${ct}" is not json`); continue; }
    const j = await r.json();
    if (a.need && !a.need(j)) { fail(`api ${a.path}`, "shape check failed"); continue; }
    if (a.needKeys) {
      const missing = a.needKeys.filter((k) => j[k] === undefined);
      if (missing.length) { fail(`api ${a.path}`, `missing keys: ${missing.join(", ")}`); continue; }
    }
    if (a.needList) {
      const list = Array.isArray(j) ? j : j[a.needList];
      if (!Array.isArray(list)) { fail(`api ${a.path}`, `expected array at "${a.needList}"`); continue; }
      if (list.length > 0) {
        const keys = Object.keys(list[0]);
        const undef = keys.filter((k) => list[0][k] === undefined);
        if (undef.length) { fail(`api ${a.path}`, `row fields undefined: ${undef.slice(0, 4).join(", ")}`); continue; }
      }
      ok(`api ${a.path}`, `${list.length} rows`);
      continue;
    }
    if (a.needArray) {
      if (!Array.isArray(j)) { fail(`api ${a.path}`, `expected array, got ${typeof j}`); continue; }
      // The classic silent breakage: rows present but every field undefined.
      if (j.length > 0) {
        const k0 = Object.keys(j[0]);
        const allNull = k0.length > 0 && k0.every((k) => j[0][k] === undefined || j[0][k] === null);
        if (allNull) { fail(`api ${a.path}`, `rows exist but all fields null/undefined`); continue; }
        const undefCount = j.filter((row) => Object.values(row).some((v) => v === undefined)).length;
        ok(`api ${a.path}`, `${j.length} rows, ${undefCount} with undefined fields`);
        continue;
      }
      ok(`api ${a.path}`, `0 rows`);
      continue;
    }
    ok(`api ${a.path}`, "ok");
  } catch (e) {
    fail(`api ${a.path}`, e.message);
  }
}

// A page can render a perfect empty state while the data lake is dead — catch that here,
// because "blank dashboard" regressions after a schema change always look like this first.
console.log("\nData lake (must be seeded, not just rendered):");
try {
  const st = await (await fetch(base + "/api/state")).json();
  const checks = [
    ["stations seeded", (st.stations ?? []).length >= 19, `${(st.stations ?? []).length}/19`],
    ["sections seeded", (st.segments ?? []).length >= 23, `${(st.segments ?? []).length}/23`],
    ["defects present", (st.counts?.openDefects ?? 0) > 0, `${st.counts?.openDefects ?? 0} open`],
    ["map coords non-zero", (st.stations ?? []).some((s) => s.x !== 0 || s.y !== 0), "projected x/y"],
    // advisory only: a plan exists once someone runs the optimiser; smoke must stay read-only
    ["latest plan present", true, st.latestPlan ? `${st.latestPlan.horizon} · ${st.latestPlan.blocks.length} blocks` : "none yet (run POST /api/optimize)"],
  ];
  for (const [name, cond, detail] of checks) {
    if (cond) ok(name, detail);
    else fail("lake", `${name} — ${detail}`);
  }
} catch (e) {
  fail("lake", e.message);
}

// Referenced media must exist. Photo paths live in the seeded lake (FIELD_PHOTOS) and in rows, and
// a missing file renders as a broken-image box on the Karmi/inspector screens — which reads as
// "the demo is unfinished" even when every API is fine. This is the cheapest possible guard against
// asset regressions, and it found four missing TRD/SNT photos on the day it was written.
console.log("\nReferenced photos (every image the UI will request):");
try {
  const [dj, dd] = await Promise.all([fetch(base + "/api/jobs").then((r) => r.json()), fetch(base + "/api/defects").then((r) => r.json())]);
  const paths = new Set();
  const add = (v) => {
    if (typeof v === "string" && v.startsWith("/photos/")) paths.add(v);
  };
  for (const j of dj.jobs ?? []) [j.reportPhoto, j.beforePhoto, j.afterPhoto].forEach(add);
  for (const d of dd.defects ?? []) add(d.photoPath);
  if (paths.size === 0) fail("photos", "no /photos/* references found — did the seed run?");
  const broken = [];
  for (const pth of [...paths].sort()) {
    const r = await fetch(base + pth);
    if (!r.ok) {
      broken.push(`${pth} (HTTP ${r.status})`);
      continue;
    }
    // Magic bytes, not just size: two of these files were 318-byte text blobs containing a
    // `data:image/svg+xml;base64,…` string saved under a .jpg name — served with HTTP 200, so a
    // status check passes while the browser renders a broken-image box.
    const buf = Buffer.from(await r.arrayBuffer());
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isWebp = buf.subarray(8, 12).toString("ascii") === "WEBP";
    if (!isJpeg && !isPng && !isWebp) broken.push(`${pth} (${buf.length}B, not a JPEG/PNG/WebP)`);
    else if (buf.length < 4096) broken.push(`${pth} (only ${buf.length}B — placeholder?)`);
  }
  if (broken.length) fail("photos", `${broken.length} broken: ${broken.join(", ")}`);
  else ok(`photos resolvable`, `${paths.size} unique images referenced by the UI`);
} catch (e) {
  fail("photos", e.message);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:");
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(Math.min(failures.length, 125));
