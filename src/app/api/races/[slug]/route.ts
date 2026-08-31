import { buildEnvelope } from '@/lib/raceApi';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const cursorRaw = new URL(req.url).searchParams.get('cursor');
  const cursor = cursorRaw === null ? -1 : Number(cursorRaw);
  const body = await buildEnvelope(
    slug,
    Date.now(),
    Number.isInteger(cursor) && cursor >= -1 ? cursor : -1,
  );
  if (body === null) {
    return new Response(JSON.stringify({ error: 'race not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
