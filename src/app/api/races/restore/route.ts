import { NextResponse } from 'next/server';
import { HttpError, restoreRace } from '@/lib/raceApi';

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
    // Rebuilds the race shell; if its timeline is missing the response says
    // so and the restoring browser regenerates + uploads it.
    const result = await restoreRace(code, Date.now());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
