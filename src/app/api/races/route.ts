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
    const { slug } = createRace(body as Parameters<typeof createRace>[0], Date.now());
    return NextResponse.json({ slug, url: `/r/${slug}` }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
