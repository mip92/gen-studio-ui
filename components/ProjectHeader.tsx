'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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

  function isActive(tabKey: string) {
    const target = tabKey ? `${base}/${tabKey}` : base;
    if (tabKey === '') return pathname === base;
    return pathname.startsWith(target);
  }

  return (
    <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-10">
      <div className="px-8 py-4 max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-zinc-500 hover:text-zinc-200 text-sm">← projects</Link>
          <div>
            <h1 className="text-lg font-semibold">{projectName}</h1>
            <p className="text-zinc-500 text-xs font-mono truncate max-w-md">{id}</p>
          </div>
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
