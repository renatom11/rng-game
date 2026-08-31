import type { ClimberLook } from '@/themes/everest/types';
import { portraitSvg } from '@/lib/portrait';

/**
 * A climber's generated portrait. Dead climbers render desaturated and dim —
 * the roster reads at a glance. Size is controlled by the parent via CSS.
 */
export default function ClimberPortrait({
  look,
  accent,
  dead = false,
  size = 44,
}: {
  look: ClimberLook | undefined;
  accent: string;
  dead?: boolean;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`portrait${dead ? ' portrait-dead' : ''}`}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: portraitSvg(look, accent) }}
    />
  );
}
