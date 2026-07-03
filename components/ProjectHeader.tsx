'use client';

import { usePathname } from 'next/navigation';
import { BreadcrumbItem } from './Breadcrumbs';
import { PageHeader } from './PageHeader';

const TABS = [
  { key: '',           label: 'Overview' },
  { key: 'characters', label: 'Состав' },
  { key: 'scenes',     label: 'Сцены' },
  { key: 'locations',  label: 'Локации' },
  { key: 'props',      label: 'Предметы' },
  { key: 'bgm',        label: 'Музыка' },
  { key: 'youtube',    label: 'YouTube' },
  { key: 'shorts',     label: 'Шорты' },
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
    <PageHeader
      crumbs={crumbs}
      title={projectName}
      subtitle={<span className="font-mono truncate block max-w-md">{id}</span>}
      tabs={TABS.map((t) => ({
        href:   t.key ? `${base}/${t.key}` : base,
        label:  t.label,
        active: isActive(t.key),
      }))}
    />
  );
}
