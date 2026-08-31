import { NextResponse } from 'next/server';
import { restoreRace, ValidationError } from '@/lib/races';
import { RaceCodeError } from '@/lib/raceCode';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const code = typeof body.code === 'string' ? body.code : '';
  if (!code) {
    return NextResponse.json({ error: 'paste a recovery code' }, { status: 400 });
  }
  try {
    const { slug, existed } = restoreRace(code, Date.now());
    return NextResponse.json({ slug, url: `/r/${slug}`, existed });
  } catch (err) {
    if (err instanceof RaceCodeError || err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
