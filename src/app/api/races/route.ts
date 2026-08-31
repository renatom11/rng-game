import { NextResponse } from 'next/server';
import { createRace, ValidationError } from '@/lib/races';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    const { slug, recoveryCode } = await createRace(
      body as Parameters<typeof createRace>[0],
      Date.now(),
    );
    // The recovery code is returned ONCE, here, to the creator — it is
    // never served again (it contains the sealed ending).
    return NextResponse.json(
      { slug, url: `/r/${slug}`, recoveryCode },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
