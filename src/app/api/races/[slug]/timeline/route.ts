import { NextResponse } from 'next/server';
import { acceptUpload, HttpError, MAX_UPLOAD_CHARS } from '@/lib/raceApi';

export const runtime = 'nodejs';

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const text = await req.text();
  if (text.length > MAX_UPLOAD_CHARS) {
    return NextResponse.json({ error: 'upload too large' }, { status: 413 });
  }
  try {
    await acceptUpload(slug, req.headers.get('x-summit-seed'), text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
