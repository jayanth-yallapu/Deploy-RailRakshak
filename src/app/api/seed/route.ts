import { NextResponse } from 'next/server';
import { ensureSeeded } from '@/lib/engine/seed';

export async function GET() {
  try {
    console.log('🌱 Starting database seed...');
    await ensureSeeded();
    console.log('✅ Database seed completed successfully!');
    
    return NextResponse.json({
      success: true,
      message: '✅ Database seeded successfully!'
    });
  } catch (error: any) {
    console.error('❌ Seed error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Seed failed'
      },
      { status: 500 }
    );
  }
}
