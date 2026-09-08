import Link from 'next/link';

/**
 * Analysis surfaces say so on a phone rather than collapsing into something
 * broken. Consumption is never behind this.
 */
export function DesktopOnly({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <>
      <div className="md:hidden">
        <div className="panel mt-6 p-5 text-center">
          <h1 className="text-sm font-semibold text-ink-100">{name} is a desktop view</h1>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-ink-400">
            This one is dense on purpose — sortable columns, sample sizes and plots that need the
            width. Everything you need to browse, rate and dismiss is in the feed.
          </p>
          <Link href="/" className="btn btn-primary mt-4">
            Back to the feed
          </Link>
        </div>
      </div>
      <div className="hidden md:block">{children}</div>
    </>
  );
}
