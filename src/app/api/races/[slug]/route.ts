import { NextResponse } from 'next/server';
import { getRaceView } from '@/lib/races';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const sinceRaw = new URL(req.url).searchParams.get('since');
  const since = sinceRaw === null ? undefined : Number(sinceRaw);
  const view = getRaceView(
    slug,
    Date.now(),
    since !== undefined && Number.isFinite(since) ? since : undefined,
  );
  if (!view) {
    return NextResponse.json({ error: 'race not found' }, { status: 404 });
  }
  return NextResponse.json(view, {
    headers: { 'cache-control': 'no-store' },
  });
}
