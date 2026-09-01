import type { Metadata } from 'next';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource-variable/martian-mono';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Summit — a very grand way to sort a list',
    template: '%s · Summit',
  },
  description:
    'Fair random ordering as a cinematic spectacle: give every name its own Everest expedition, over minutes or hours. Provably fair, spoiler-proof, undecided until the end.',
  openGraph: {
    title: 'Summit',
    description:
      'A duck race on an epic scale — draft orders and who-goes-first, decided by an Everest expedition. Check in any time; the ending stays secret.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
