import { NextResponse } from 'next/server';
import { ValidationError, type CreateRaceInput } from '@/lib/races';
import { initRace } from '@/lib/raceApi';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    // Init commits the seed server-side; the creator's browser generates
    // the timeline from it and uploads chunks next. The recovery code is
    // returned ONCE, here (it contains the sealed ending).
    const result = await initRace(body as CreateRaceInput, Date.now());
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
