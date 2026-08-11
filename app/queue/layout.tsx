'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { BreadcrumbItem } from '../../components/Breadcrumbs';
import { PageHeader } from '../../components/PageHeader';

const TABS = [
  { slug: 'active', label: 'Активные' },
  { slug: 'all',    label: 'Все'      },
  { slug: 'done',   label: 'Готовые'  },
] as const;

// useSearchParams() needs a Suspense boundary in Next 16 or the production build
// bails out. Only QueueLayoutWithQuery reads it — usePathname() needs no boundary,
// so the shell renders identically while suspended, just with bare tab links.
export default function QueueLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<QueueLayoutShell qs="">{children}</QueueLayoutShell>}>
      <QueueLayoutWithQuery>{children}</QueueLayoutWithQuery>
    </Suspense>
  );
}

function QueueLayoutWithQuery({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  // Filters and sort travel between tabs; the page number does not. The three
  // tabs list different row sets, so "стр. 20" of the history archive is
  // meaningless in Активные — start the new tab at its first page.
  const params = new URLSearchParams(searchParams.toString());
  params.delete('page');
  return <QueueLayoutShell qs={params.toString()}>{children}</QueueLayoutShell>;
}

function QueueLayoutShell({ qs, children }: { qs: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const tab = TABS.find((t) => pathname?.endsWith(`/queue/${t.slug}`));

  const crumbs: BreadcrumbItem[] = [
    { label: 'Обзор',    href: '/' },
    { label: 'Очередь',  href: tab ? '/queue/active' : undefined },
    ...(tab ? [{ label: tab.label }] : []),
  ];

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <PageHeader
        crumbs={crumbs}
        title="Очередь"
        tabs={TABS.map((t) => ({
          // Carry the current filters/sort/page across tabs — switching
          // Активные → Все must not silently drop a project filter the user set.
          // Params the target tab's preset already covers are simply overridden.
          href:   qs ? `/queue/${t.slug}?${qs}` : `/queue/${t.slug}`,
          label:  t.label,
          active: tab?.slug === t.slug,
        }))}
      />
      <main className="p-4 sm:p-8">{children}</main>
    </div>
  );
}
