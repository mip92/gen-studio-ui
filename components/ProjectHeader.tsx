'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs';

const TABS = [
  { key: '',           label: 'Overview' },
  { key: 'characters', label: 'Персонажи' },
  { key: 'scenes',     label: 'Сцены' },
];

export function ProjectHeader({
  id,
  projectName,
}: {
  id:          string;
  projectName: string;
}) {
  const pathname = usePathname();
  const base     = `/projects/${id}`;

  // Deeper layouts (CharacterPageShell, ShotPageShell) render their own sticky
  // header WITH their own breadcrumbs and their own tab strip. Stacking the
  // project-level header on top of those is redundant and makes the page look
  // like it has two headers — so we hide ourselves on those routes. The
  // deeper crumbs already chain back to Projects → <project> → … correctly.
  if (pathname?.startsWith(`${base}/characters/`) || pathname?.startsWith(`${base}/shots/`)) {
    const seg = pathname.split('/');
    // /projects/[id]/characters       → no [profileId] yet, keep header
    // /projects/[id]/characters/[id]  → CharacterPageShell takes over
    // /projects/[id]/shots/[id]       → ShotPageShell takes over
    const hasDeepSegment = seg.length >= 5 && seg[4] && seg[4].length > 0;
    if (hasDeepSegment) return null;
  }

  function isActive(tabKey: string) {
    const target = tabKey ? `${base}/${tabKey}` : base;
    if (tabKey === '') return pathname === base;
    return pathname.startsWith(target);
  }

  const activeTab = TABS.find((t) => isActive(t.key));
  const crumbs: BreadcrumbItem[] = [
    { label: 'Projects',     href: '/' },
    { label: projectName,    href: activeTab && activeTab.key ? base : undefined },
    ...(activeTab && activeTab.key ? [{ label: activeTab.label }] : []),
  ];

  return (
    <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-10">
      <div className="px-8 pt-3 max-w-7xl mx-auto">
        <Breadcrumbs items={crumbs} />
      </div>
      <div className="px-8 pb-4 max-w-7xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{projectName}</h1>
          <p className="text-zinc-500 text-xs font-mono truncate max-w-md">{id}</p>
        </div>
      </div>
      <nav className="px-8 max-w-7xl mx-auto flex gap-1">
        {TABS.map((t) => {
          const active = isActive(t.key);
          const href = t.key ? `${base}/${t.key}` : base;
          return (
            <Link
              key={t.key}
              href={href}
              className={`px-4 py-2 text-sm border-b-2 transition ${
                active
                  ? 'border-blue-500 text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
