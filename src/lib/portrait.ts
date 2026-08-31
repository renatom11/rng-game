import type { ClimberLook } from '@/themes/everest/types';

/**
 * Generated climber portraits: flat, warm, ~48px. This module is pure data →
 * SVG-markup string so the React component and the non-React demo bundle
 * share one renderer. Skin tones are indexed by the dossier's heritage-banded
 * `look.skin`; everything else is variant indices from the same `look`.
 */

export const SKIN_TONES = [
  '#f3d8c0', '#e8bf9a', '#d29e6d', '#a9724a', '#845331', '#5f3b22',
];

export const HAIR_COLORS = [
  '#1d1a17', '#3c2a1c', '#6b4a2c', '#a87c4f', '#8e8e8e',
];

const FACE_INK = '#23180f';

/**
 * Inner SVG markup for a portrait (viewBox "0 0 48 48"). `accent` is the
 * team color — it paints the parka and any headgear.
 */
export function portraitSvg(look: ClimberLook | undefined, accent: string): string {
  const skin = SKIN_TONES[(look?.skin ?? 2) % SKIN_TONES.length];
  const hairC = HAIR_COLORS[(look?.hairColor ?? 0) % HAIR_COLORS.length];
  const hair = look?.hair ?? 0;
  const facial = look?.facial ?? 0;
  const headgear = look?.headgear ?? 3;
  const parts: string[] = [];

  // Parka shoulders.
  parts.push(`<path d="M6 48 C8 38 16 34 24 34 C32 34 40 38 42 48 Z" fill="${accent}"/>`);
  // Hood back (drawn behind the head).
  if (headgear === 1) {
    parts.push(`<path d="M11 34 Q7 6 24 6 Q41 6 37 34 Q36 20 24 10 Q12 20 11 34 Z" fill="${accent}"/>`);
  }
  // Neck + head.
  parts.push(`<rect x="20" y="26" width="8" height="10" fill="${skin}"/>`);
  parts.push(`<ellipse cx="24" cy="20" rx="10" ry="11" fill="${skin}"/>`);

  // Facial hair (under the mouth so the mouth stays visible).
  if (facial === 1) {
    parts.push(`<ellipse cx="24" cy="26.5" rx="7" ry="4.6" fill="${hairC}" opacity="0.22"/>`);
  } else if (facial === 3) {
    parts.push(`<ellipse cx="24" cy="26.5" rx="8.4" ry="6.2" fill="${hairC}"/>`);
    parts.push(`<ellipse cx="24" cy="24.4" rx="6.2" ry="4.2" fill="${skin}"/>`);
  }
  // Mouth.
  parts.push(`<path d="M21 27.5 Q24 29 27 27.5" stroke="${FACE_INK}" stroke-width="1.1" stroke-linecap="round" fill="none" opacity="0.75"/>`);
  if (facial === 2) {
    parts.push(`<rect x="20" y="24.6" width="8" height="1.8" rx="0.9" fill="${hairC}"/>`);
  }

  // Hair — hidden under a hood, and variant 5 is "tucked away".
  if (headgear !== 1 && hair !== 5) {
    if (hair === 0) {
      parts.push(`<path d="M14 17 Q14 9 24 9 Q34 9 34 17 Q30 12.5 24 12.5 Q18 12.5 14 17 Z" fill="${hairC}"/>`);
    } else if (hair === 1) {
      parts.push(`<path d="M14 18 Q13 9 25 9 Q35 10 34 16 Q26 11 20 13 Q16 14.5 14 18 Z" fill="${hairC}"/>`);
    } else if (hair === 2) {
      parts.push(`<path d="M14 17 Q14 9 24 9 Q34 9 34 17 Q30 12.5 24 12.5 Q18 12.5 14 17 Z" fill="${hairC}"/>`);
      parts.push(`<rect x="12.6" y="15" width="2.6" height="11" rx="1.3" fill="${hairC}"/>`);
      parts.push(`<rect x="32.8" y="15" width="2.6" height="11" rx="1.3" fill="${hairC}"/>`);
      if (headgear === 3) parts.push(`<circle cx="24" cy="7.6" r="2.6" fill="${hairC}"/>`);
    } else if (hair === 3) {
      parts.push(`<path d="M15 15.5 Q16 10.5 24 10.5 Q32 10.5 33 15.5 Q28 12.8 24 12.8 Q20 12.8 15 15.5 Z" fill="${hairC}" opacity="0.85"/>`);
    } else if (hair === 4) {
      parts.push(`<circle cx="17" cy="12.5" r="4" fill="${hairC}"/>`);
      parts.push(`<circle cx="24" cy="10.5" r="4.6" fill="${hairC}"/>`);
      parts.push(`<circle cx="31" cy="12.5" r="4" fill="${hairC}"/>`);
    }
  }

  // Headgear front.
  if (headgear === 0) {
    parts.push(`<path d="M13 16 Q13 7 24 7 Q35 7 35 16 L35 18 Q24 15 13 18 Z" fill="${accent}"/>`);
    parts.push(`<path d="M13 16 L35 16 L35 18 Q24 15 13 18 Z" fill="#ffffff" opacity="0.25"/>`);
    parts.push(`<circle cx="24" cy="6.4" r="2" fill="#e9eef6"/>`);
  } else if (headgear === 1) {
    parts.push(`<path d="M12 30 Q9 8 24 8 Q39 8 36 30 L33.5 28 Q35 12 24 11.5 Q13 12 14.5 28 Z" fill="${accent}"/>`);
  } else if (headgear === 2) {
    parts.push(`<path d="M14 15 Q14 8 24 8 Q34 8 34 15 Z" fill="${accent}"/>`);
    parts.push(`<rect x="23" y="13.4" width="14" height="2.2" rx="1.1" fill="${accent}"/>`);
  }

  // Brows + eyes last, over everything.
  parts.push(`<rect x="17.6" y="16.4" width="4.6" height="1.3" rx="0.65" fill="${hairC}"/>`);
  parts.push(`<rect x="25.8" y="16.4" width="4.6" height="1.3" rx="0.65" fill="${hairC}"/>`);
  parts.push(`<circle cx="20" cy="20.2" r="1.35" fill="${FACE_INK}"/>`);
  parts.push(`<circle cx="28" cy="20.2" r="1.35" fill="${FACE_INK}"/>`);

  return parts.join('');
}
