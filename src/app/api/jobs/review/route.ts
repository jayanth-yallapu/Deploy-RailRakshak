import { NextResponse } from 'next/server';
import { db } from '@/db';
import { jobs, defects } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const { jobId, action, note } = await request.json();

    if (action === "accept") {
      // Update job status to SIGNED_OFF
      await db.update(jobs)
        .set({ 
          status: 'SIGNED_OFF',
          reviewNote: note || 'Accepted by Inspector',
        })
        .where(eq(jobs.id, jobId));

      // Update linked defect status
      const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (job.length > 0 && job[0].defectId) {
        await db.update(defects)
          .set({ status: 'signed_off' })
          .where(eq(defects.id, job[0].defectId));
      }

      return NextResponse.json({ success: true, action: 'accepted' });
    } else {
      // Reject
      await db.update(jobs)
        .set({ 
          status: 'REJECTED',
          reviewNote: note || 'Rejected by Inspector',
        })
        .where(eq(jobs.id, jobId));

      return NextResponse.json({ success: true, action: 'rejected' });
    }
  } catch (error: any) {
    console.error('Review error:', error);
    return NextResponse.json(
      { error: error.message || 'Review failed' },
      { status: 500 }
    );
  }
}