import { NextResponse } from 'next/server';
import { getRaceView } from '@/lib/races';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const view = getRaceView(slug, Date.now());
  if (!view) {
    return NextResponse.json({ error: 'race not found' }, { status: 404 });
  }
  return NextResponse.json(view, {
    headers: { 'cache-control': 'no-store' },
  });
}
