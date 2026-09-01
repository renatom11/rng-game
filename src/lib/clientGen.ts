import type { CreateRaceInput, RaceConfigStored, Theme } from './races';
import { buildChunks, serializeUpload, type BuiltChunks } from './chunking';
import type { EverestTimeline } from '@/themes/everest/types';

/**
 * Client-side race generation for the chunk protocol. Loaded lazily (the
 * engine + themes are ~100KB gz) and only on pages that create, restore,
 * or verify races. The seed always comes from the server (committed at
 * init) — this module never draws one.
 */

export async function generateTimelineFor(
  theme: Theme,
  seed: string,
  teams: RaceConfigStored['teams'],
  durationMs: number,
): Promise<EverestTimeline> {
  void theme;
  const { generateEverest } = await import('@/themes/everest/generate');
  return generateEverest(seed, { teams, durationMs });
}

export async function buildUploadBody(
  theme: Theme,
  seed: string,
  teams: RaceConfigStored['teams'],
  durationMs: number,
): Promise<{ body: string; built: BuiltChunks }> {
  const timeline = await generateTimelineFor(theme, seed, teams, durationMs);
  const built = buildChunks(theme, timeline, durationMs);
  return { body: serializeUpload(built), built };
}

export interface CreatedRace {
  slug: string;
  url: string;
  recoveryCode: string;
}

/**
 * The full create flow: init (server commits the seed) → generate in this
 * browser → upload chunks. Used by the create form, the landing demo
 * buttons, and the restore page.
 */
export async function createRaceFromBrowser(
  input: CreateRaceInput,
): Promise<CreatedRace> {
  const initRes = await fetch('/api/races', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const init = await initRes.json();
  if (!initRes.ok) throw new Error(init.error ?? 'could not create the race');

  await generateAndUpload(
    init.slug,
    init.seed,
    (input.theme ?? 'everest') as Theme,
    input.teams as RaceConfigStored['teams'],
    input.durationMs,
  );
  try {
    // The show-once recovery banner on the race page reads this.
    sessionStorage.setItem(`summit-code-${init.slug}`, init.recoveryCode);
  } catch {
    // storage unavailable — the race still works, just no banner
  }
  return { slug: init.slug, url: init.url, recoveryCode: init.recoveryCode };
}

export async function generateAndUpload(
  slug: string,
  seed: string,
  theme: Theme,
  teams: RaceConfigStored['teams'],
  durationMs: number,
): Promise<void> {
  const { body } = await buildUploadBody(theme, seed, teams, durationMs);
  const upRes = await fetch(`/api/races/${slug}/timeline`, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain;charset=utf-8', 'x-summit-seed': seed },
    body,
  });
  if (!upRes.ok) {
    const data = await upRes.json().catch(() => ({}));
    // 409 = someone else's upload landed first — the race exists, all good.
    if (upRes.status !== 409) {
      throw new Error(data.error ?? 'could not upload the race timeline');
    }
  }
}
