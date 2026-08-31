import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Summit',
  description:
    'A grand-scale duck race: fair random ordering, told as a cinematic expedition.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
