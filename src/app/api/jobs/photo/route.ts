import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const photo = formData.get('photo') as File;
    const jobId = formData.get('jobId') as string;
    const type = formData.get('type') as string; // 'before' or 'after'

    if (!photo) {
      return NextResponse.json({ error: 'No photo uploaded' }, { status: 400 });
    }

    if (!jobId || !type) {
      return NextResponse.json({ error: 'Missing jobId or type' }, { status: 400 });
    }

    // Save to public/photos/
    const uploadDir = path.join(process.cwd(), 'public/photos');
    await mkdir(uploadDir, { recursive: true });

    const fileName = `job-${jobId}-${type}-${Date.now()}.jpg`;
    const filePath = path.join(uploadDir, fileName);
    const bytes = await photo.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    const photoPath = `/photos/${fileName}`;

    // Update the job with the photo path
    const updateField = type === 'before' ? 'beforePhoto' : 'afterPhoto';
    await db.update(jobs)
      .set({ [updateField]: photoPath })
      .where(eq(jobs.id, Number(jobId)));

    return NextResponse.json({
      success: true,
      path: photoPath,
      message: `${type} photo uploaded successfully`
    });

  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Upload failed' },
      { status: 500 }
    );
  }
}