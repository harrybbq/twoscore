import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { NavLinks } from '@/components/NavLinks';

export const metadata: Metadata = {
  title: 'twoscore',
  description: 'Two scores per title: how much you would admire it, and whether you would go back.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#08090b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 font-sans text-ink-100 antialiased">
        <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-2 sm:px-4">
            <Link href="/" className="flex items-baseline gap-1.5 font-mono text-sm font-semibold">
              <span className="text-signal">two</span>
              <span className="text-ink-200">score</span>
            </Link>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-3 pb-24 pt-3 sm:px-4">{children}</main>
      </body>
    </html>
  );
}
