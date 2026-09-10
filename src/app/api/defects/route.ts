import { NextResponse } from 'next/server';
import { db } from '@/db';
import { defects } from '@/db/schema';

export async function GET() {
  try {
    const results = await db.select().from(defects);
    
    // Map snake_case to camelCase
    const mapped = results.map(d => ({
      id: d.id,
      segmentId: d.segment_id,
      department: d.department,
      title: d.title,
      note: d.note,
      status: d.status,
      severity: d.severity,
      gps: d.gps,
      photoPath: d.photo_path,
      failureProb72h: d.failure_prob_72h,
      overdueDays: d.overdue_days,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
    
    return NextResponse.json(mapped);
  } catch (error: any) {
    console.error('Defects API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}