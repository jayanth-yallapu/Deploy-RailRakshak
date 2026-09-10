import { db } from '@/db';
import { stations, segments, settings } from '@/db/schema';

// Delhi NCR Stations
const STATION_DATA = [
  { code: 'NDLS', name: 'New Delhi', kind: 'terminal', x: 0, y: 0, lat: 28.6139, lng: 77.2090, dailyTrains: 400, vipZone: true },
  { code: 'NZM', name: 'Hazrat Nizamuddin', kind: 'junction', x: 0, y: 0, lat: 28.5912, lng: 77.2500, dailyTrains: 200, vipZone: false },
  { code: 'DLI', name: 'Delhi Junction', kind: 'terminal', x: 0, y: 0, lat: 28.6610, lng: 77.2284, dailyTrains: 300, vipZone: false },
  { code: 'GZB', name: 'Ghaziabad', kind: 'junction', x: 0, y: 0, lat: 28.6692, lng: 77.4538, dailyTrains: 250, vipZone: false },
  { code: 'ANVT', name: 'Anand Vihar Terminal', kind: 'terminal', x: 0, y: 0, lat: 28.6482, lng: 77.3149, dailyTrains: 150, vipZone: false },
  { code: 'SBB', name: 'Sahibabad', kind: 'junction', x: 0, y: 0, lat: 28.6830, lng: 77.5050, dailyTrains: 100, vipZone: false },
  { code: 'OKA', name: 'Okhla', kind: 'halt', x: 0, y: 0, lat: 28.5670, lng: 77.2770, dailyTrains: 60, vipZone: false },
  { code: 'FDB', name: 'Faridabad', kind: 'junction', x: 0, y: 0, lat: 28.4089, lng: 77.3178, dailyTrains: 120, vipZone: false },
  { code: 'PWL', name: 'Palwal', kind: 'junction', x: 0, y: 0, lat: 28.1425, lng: 77.3250, dailyTrains: 100, vipZone: false },
  { code: 'MTJ', name: 'Mathura', kind: 'junction', x: 0, y: 0, lat: 27.4924, lng: 77.6737, dailyTrains: 200, vipZone: false },
];

const SEGMENT_DATA = [
  { code: 'NDLS-NZM', fromCode: 'NDLS', toCode: 'NZM', corridor: 'DEL-HWH', lengthKm: 5.2, isBridge: false, dailyTrains: 300, criticality: 8, maxSpeed: 110 },
  { code: 'NZM-ANVT', fromCode: 'NZM', toCode: 'ANVT', corridor: 'DEL-HWH', lengthKm: 8.0, isBridge: true, dailyTrains: 200, criticality: 9, maxSpeed: 100 },
  { code: 'GZB-ANVT', fromCode: 'GZB', toCode: 'ANVT', corridor: 'DEL-KLK', lengthKm: 10.5, isBridge: false, dailyTrains: 180, criticality: 6, maxSpeed: 110 },
  { code: 'NDLS-GZB', fromCode: 'NDLS', toCode: 'GZB', corridor: 'DEL-KLK', lengthKm: 18.0, isBridge: false, dailyTrains: 220, criticality: 8, maxSpeed: 130 },
  { code: 'SBB-GZB', fromCode: 'SBB', toCode: 'GZB', corridor: 'RRTS', lengthKm: 6.0, isBridge: false, dailyTrains: 80, criticality: 5, maxSpeed: 160 },
  { code: 'FDB-PWL', fromCode: 'FDB', toCode: 'PWL', corridor: 'DEL-BCT', lengthKm: 22.0, isBridge: false, dailyTrains: 150, criticality: 6, maxSpeed: 110 },
  { code: 'NDLS-DLI', fromCode: 'NDLS', toCode: 'DLI', corridor: 'DEL-BCT', lengthKm: 4.5, isBridge: false, dailyTrains: 250, criticality: 7, maxSpeed: 90 },
];

export async function ensureSeeded() {
  const existing = await db.select().from(stations).limit(1);
  if (existing.length > 0) {
    console.log('✅ Database already seeded');
    return;
  }

  console.log('🌱 Seeding database...');
  await db.insert(stations).values(STATION_DATA);
  console.log('✅ Stations inserted');
  await db.insert(segments).values(SEGMENT_DATA);
  console.log('✅ Segments inserted');
  await db.insert(settings).values([
    { key: 'fog_mode', value: 'false' },
    { key: 'vip_corridor', value: 'false' },
    { key: 'dtp_redzone', value: 'false' },
  ]);
  console.log('✅ Settings inserted');
}

export async function seed() {
  await ensureSeeded();
}