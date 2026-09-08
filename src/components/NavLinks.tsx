'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Analysis routes are marked so it is obvious which ones need a big screen. */
const LINKS = [
  { href: '/', label: 'Feed', desktopOnly: false },
  { href: '/table', label: 'Table', desktopOnly: true },
  { href: '/affinities', label: 'Affinities', desktopOnly: true },
  { href: '/calibration', label: 'Calibration', desktopOnly: true },
  { href: '/tune', label: 'Tune', desktopOnly: true },
  { href: '/compare', label: 'Compare', desktopOnly: true },
  { href: '/import', label: 'Import', desktopOnly: false },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto text-xs">
      {LINKS.map((l) => {
        const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={[
              'whitespace-nowrap rounded px-2 py-1 transition',
              active ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-200',
              l.desktopOnly ? 'hidden md:inline-block' : '',
            ].join(' ')}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
