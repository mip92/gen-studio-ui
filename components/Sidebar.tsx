'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ProjectListItem } from '../lib/api';

/**
 * Persistent left-side navigation. On desktop (md+) it's a sticky column via
 * <Sidebar>. On mobile the same content is rendered inside the slide-in drawer
 * from <MobileNav> — both share <SidebarNavContent> so there's one source of
 * truth for the links.
 *
 * Sections:
 *   - top-level: Projects, Queue (with the 3 tabs as sub-links)
 *   - current project (only when the URL is /projects/[id]/...): Overview,
 *     Персонажи, Сцены, plus a project picker so the user can jump between
 *     projects without going back to the root.
 *
 * Active route is highlighted by comparing usePathname() against each link.
 */
export function Sidebar() {
  return (
    <aside className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 sticky top-0 h-screen overflow-y-auto">
      <SidebarNavContent />
    </aside>
  );
}

/**
 * The brand + nav links, with no positioning of its own so it can be dropped
 * into both the desktop <aside> and the mobile drawer. `onNavigate` (when given)
 * fires on every link tap — the drawer uses it to close itself.
 */
export function SidebarNavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '/';
  const projectId = extractProjectId(pathname);

  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const project = projectId
    ? projects?.find((p) => p.id === projectId || p.slug === projectId)
    : null;

  return (
    <>
      <Link href="/" onClick={onNavigate} className="px-4 pt-4 pb-3 block">
        <div className="text-sm font-semibold text-zinc-100">Gen Studio</div>
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">LoRA · scenes · video</div>
      </Link>

      <nav className="px-2 pb-4 flex-1 space-y-4">
        <Section title="Главное">
          <NavLink href="/"           label="Overview"   active={pathname === '/'} onNavigate={onNavigate} />
          <NavLink href="/projects"   label="Projects"   active={pathname === '/projects'} onNavigate={onNavigate} />
          <NavLink href="/characters" label="Персонажи"  active={pathname.startsWith('/characters')} onNavigate={onNavigate} />
          <NavLink href="/voices"     label="Озвучка"    active={pathname.startsWith('/voices')} onNavigate={onNavigate} />
          <NavLink href="/actions"    label="Действия"   active={pathname.startsWith('/actions')} onNavigate={onNavigate} />
        </Section>

        <Section title="Очередь">
          <NavLink href="/queue/active" label="Активные"      active={pathname.startsWith('/queue/active')} onNavigate={onNavigate} />
          <NavLink href="/queue/all"    label="Все"           active={pathname.startsWith('/queue/all')} onNavigate={onNavigate} />
          <NavLink href="/queue/done"   label="Готовые"       active={pathname.startsWith('/queue/done')} onNavigate={onNavigate} />
        </Section>

        {projectId && (
          <Section title={project?.name ?? 'Проект'}>
            <NavLink href={`/projects/${projectId}`}            label="Overview"  active={pathname === `/projects/${projectId}`} onNavigate={onNavigate} />
            <NavLink href={`/projects/${projectId}/characters`} label="Состав"    active={pathname.startsWith(`/projects/${projectId}/characters`)} onNavigate={onNavigate} />
            <NavLink href={`/projects/${projectId}/scenes`}     label="Сцены"     active={pathname.startsWith(`/projects/${projectId}/scenes`) || pathname.startsWith(`/projects/${projectId}/shots`)} onNavigate={onNavigate} />
            <NavLink href={`/projects/${projectId}/bgm`}        label="Музыка"    active={pathname.startsWith(`/projects/${projectId}/bgm`)} onNavigate={onNavigate} />
          </Section>
        )}

        {projects && projects.length > 1 && (
          <Section title="Другие проекты">
            {projects
              .filter((p) => !projectId || (p.id !== projectId && p.slug !== projectId))
              .map((p) => (
                <NavLink key={p.id} href={`/projects/${p.id}`} label={p.name} active={false} onNavigate={onNavigate} />
              ))}
          </Section>
        )}
      </nav>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 mb-1 text-[10px] uppercase tracking-wider text-zinc-600">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({ href, label, active, onNavigate }: { href: string; label: string; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`block px-2 py-1.5 rounded text-sm transition-colors truncate ${
        active
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
      }`}
    >
      {label}
    </Link>
  );
}

/** Pull the [id] out of `/projects/[id]/...`. Returns null on any other route. */
function extractProjectId(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m ? m[1] : null;
}
