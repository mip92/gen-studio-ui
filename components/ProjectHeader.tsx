'use client';

import { usePathname } from 'next/navigation';
import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs';
import { ScrollableTabs } from './ScrollableTabs';

const TABS = [
  { key: '',           label: 'Overview' },
  { key: 'characters', label: 'Состав' },
  { key: 'scenes',     label: 'Сцены' },
  { key: 'locations',  label: 'Локации' },
  { key: 'bgm',        label: 'Музыка' },
  { key: 'settings',   label: 'Настройки' },
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
    { label: 'Overview',     href: '/' },
    { label: 'Projects',     href: '/projects' },
    { label: projectName,    href: activeTab && activeTab.key ? base : undefined },
    ...(activeTab && activeTab.key ? [{ label: activeTab.label }] : []),
  ];

  return (
    <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-10">
      <div className="px-4 sm:px-8 pt-3 max-w-7xl mx-auto">
        <Breadcrumbs items={crumbs} />
      </div>
      <div className="px-4 sm:px-8 pb-4 max-w-7xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{projectName}</h1>
          <p className="text-zinc-500 text-xs font-mono truncate max-w-md">{id}</p>
        </div>
      </div>
      <div className="px-4 sm:px-8 max-w-7xl mx-auto">
        <ScrollableTabs
          tabs={TABS.map((t) => ({
            href:   t.key ? `${base}/${t.key}` : base,
            label:  t.label,
            active: isActive(t.key),
          }))}
        />
      </div>
    </header>
  );
}
