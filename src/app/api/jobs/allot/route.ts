import { NextResponse } from 'next/server';
import { db } from '@/db';
import { defects, jobs } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const { defectId, teamLeader } = await request.json();

    // Update the defect status to "allotted"
    await db.update(defects)
      .set({ status: 'allotted' })
      .where(eq(defects.id, defectId));

    // Update the linked job status to "ALLOTTED" and set team leader
    const [updatedJob] = await db.update(jobs)
      .set({ 
        status: 'ALLOTTED',
        teamLeader: teamLeader,
      })
      .where(eq(jobs.defectId, defectId))
      .returning();

    return NextResponse.json({
      success: true,
      job: updatedJob,
    });

  } catch (error: any) {
    console.error('Allot error:', error);
    return NextResponse.json(
      { error: error.message || 'Allotment failed' },
      { status: 500 }
    );
  }
}