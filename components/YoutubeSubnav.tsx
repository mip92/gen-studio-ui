'use client';

import { usePathname } from 'next/navigation';

/** Sub-navigation inside the YouTube section: packaging · shorts · launch. */
export function YoutubeSubnav({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/projects/${id}/youtube`;
  const items = [
    { href: base,               label: 'Видео' },
    { href: `${base}/shorts`,   label: 'Шорты' },
    { href: `${base}/launch`,   label: '🔗 Связка-запуск' },
  ];
  const isActive = (href: string) => (href === base ? pathname === base : pathname?.startsWith(href));

  return (
    <div className="flex gap-1 mb-5 border-b border-zinc-800">
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
            isActive(it.href) ? 'border-red-600 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {it.label}
        </a>
      ))}
    </div>
  );
}
