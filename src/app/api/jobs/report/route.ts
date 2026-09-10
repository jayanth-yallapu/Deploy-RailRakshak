import { NextResponse } from 'next/server';
import { db } from '@/db';
import { defects, jobs } from '@/db/schema';
import { DEFECT_KINDS } from '@/lib/engine/seed';
import { severityToNum, SEVERITY_LEVELS } from '@/lib/engine/severity';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log("📥 Received report:", { 
      title: body.title, 
      department: body.department,
      segmentId: body.segmentId 
    });

    const { title, segmentId, department, note, photoData, gps } = body;

    // Severity used to be hardcoded to "medium" here, so a patroller reporting a transverse rail-head
    // crack entered the planning pool with the same priority as a faded paint complaint. What the
    // patroller taps is now the input; if they tap nothing, the behaviour is unchanged (medium), and
    // the duration / block requirement come from the same taxonomy the seeded backlog uses, so a
    // "Rail head crack" report is given the same 150-minute physical block as any other.
    const dept = String(department ?? "ENG").toUpperCase();
    const kind = (DEFECT_KINDS[dept as keyof typeof DEFECT_KINDS] ?? []).find(
      (k) => typeof title === "string" && (title.startsWith(k.title) || k.title.startsWith(String(title).split(" — ")[0]))
    ) ?? null;
    const reported = typeof body.severity === "string" && SEVERITY_LEVELS.includes(body.severity as (typeof SEVERITY_LEVELS)[number])
      ? body.severity
      : null;
    const severity = reported ?? "medium";
    const severityNum = severityToNum(severity);
    const durationMin = Math.max(10, Math.min(720, Number(body.durationMin) || kind?.durationMin || 60));
    const inspectionMode = kind?.mode ?? "physical";
    const requiresBlock = body.requiresBlock === true || body.requiresBlock === false ? body.requiresBlock : (kind?.requiresBlock ?? true);

    let photoPath = null;

    // Save photo to public/photos/
    if (photoData) {
      try {
        const uploadDir = path.join(process.cwd(), 'public/photos');
        await mkdir(uploadDir, { recursive: true });

        const matches = photoData.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1];
          const data = matches[2];
          const buffer = Buffer.from(data, 'base64');
          const fileName = `patrol-${Date.now()}.${ext}`;
          const filePath = path.join(uploadDir, fileName);
          await writeFile(filePath, buffer);
          photoPath = `/photos/${fileName}`;
          console.log("💾 Photo saved:", photoPath);
        }
      } catch (photoError) {
        console.error('❌ Photo save error:', photoError);
        // Continue without photo
      }
    }

    // ✅ Insert into defects (using the new simplified schema)
    const [defect] = await db.insert(defects).values({
      segmentId: segmentId,
      department: department,
      title: title,
      note: note || '',
      status: 'pending',        // ← Inspector will see this
      severity,                 // ← as reported, not as assumed
      durationMin,
      inspectionMode,
      requiresBlock,
      overdueDays: 0,
      gps: gps || null,
      photoPath: photoPath,     // ← store the photo path
    }).returning();

    console.log("✅ Defect created:", defect.id);

    // ✅ Insert linked job (pending_allotment)
    const [job] = await db.insert(jobs).values({
      defectId: defect.id,
      segmentId: segmentId,
      department: department,
      title: title,
      note: note || '',
      status: 'PENDING',        // ← Karmi will see this after allotment
    }).returning();

    console.log("✅ Job created:", job.id);

    return NextResponse.json({
      success: true,
      id: job.id,
      defectId: defect.id,
      photoPath: photoPath,
      logged: {
        severity,
        severityNum,
        durationMin,
        requiresBlock,
        inspectionMode,
        // tells the patroller (and the audit) whether the queue entry was taken as tapped or defaulted
        severitySource: reported ? "reported" : "defaulted to medium — not tapped on the handset",
        matchedTaxonomy: kind?.title ?? null,
      },
    });

  } catch (error: any) {
    console.error('❌ Report error:', error);
    return NextResponse.json(
      { error: error.message || 'Report failed' },
      { status: 500 }
    );
  }
}