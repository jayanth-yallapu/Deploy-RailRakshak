import { NextResponse } from 'next/server';
import { db } from '@/db';
import { jobs } from '@/db/schema';

export async function GET() {
  try {
    const allJobs = await db.select().from(jobs);
    console.log("📋 Jobs fetched:", allJobs.length);
    return NextResponse.json(allJobs);
  } catch (error: any) {
    console.error('Jobs API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}