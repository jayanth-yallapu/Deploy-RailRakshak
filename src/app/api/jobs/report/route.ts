import { NextResponse } from 'next/server';
import { db } from '@/db';
import { defects, jobs } from '@/db/schema';
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
      severity: 'medium',
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
    });

  } catch (error: any) {
    console.error('❌ Report error:', error);
    return NextResponse.json(
      { error: error.message || 'Report failed' },
      { status: 500 }
    );
  }
}