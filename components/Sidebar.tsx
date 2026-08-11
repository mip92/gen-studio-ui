'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ProjectListItem, isProjectArchived } from '../lib/api';

/**
 * Persistent left-side navigation. On desktop (md+) it's a sticky column via
 * <Sidebar>. On mobile the same content is rendered inside the slide-in drawer
 * from <MobileNav> — both share <SidebarNavContent> so there's one source of
 * truth for the links.
 *
 * The project list is fetched once server-side (root layout → `projects` prop),
 * so this component is purely presentational + interactive: no data fetching,
 * no loading flash.
 *
 * Sections:
 *   - Главное: Overview, Projects (collapsible list of active projects),
 *     Персонажи, Озвучка, Действия, Архив.
 *   - Очередь.
 *   - current project (only on /projects/[id]/...): Overview, Состав, Акты, Музыка.
 *
 * Active route is highlighted by comparing usePathname() against each link.
 */
export function Sidebar({ projects }: { projects: ProjectListItem[] }) {
  return (
    // Desktop only. The document scrolls now, so the aside is genuinely sticky:
    // it pins to the top and keeps its own scrollbar when the link list is
    // longer than the screen. h-dvh, not h-screen — 100vh is the LARGE viewport,
    // which on a tablet with browser UI visible runs 60–115px taller than what
    // you can see and clips the bottom links out of reach.
    <aside className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 sticky top-0 h-dvh overflow-y-auto">
      <SidebarNavContent projects={projects} />
    </aside>
  );
}

/**
 * The brand + nav links, with no positioning of its own so it can be dropped
 * into both the desktop <aside> and the mobile drawer. `onNavigate` (when given)
 * fires on every link tap — the drawer uses it to close itself.
 */
export function SidebarNavContent({
  projects,
  onNavigate,
}: {
  projects: ProjectListItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? '/';
  const projectId = extractProjectId(pathname);

  // Only active (in-production) projects live in the sidebar; finished ones move
  // to /projects/archived so the menu stays short as the catalogue grows.
  const activeProjects = projects.filter((p) => !isProjectArchived(p));

  const project = projectId
    ? projects.find((p) => p.id === projectId || p.slug === projectId)
    : null;

  // The "Projects" list is collapsed by default — click the chevron to reveal it.
  const [projectsOpen, setProjectsOpen] = useState(false);

  return (
    <>
      <Link href="/" onClick={onNavigate} className="px-4 pt-4 pb-3 block">
        <div className="text-sm font-semibold text-zinc-100">Gen Studio</div>
      </Link>

      <nav className="px-2 pb-4 flex-1 space-y-4">
        <Section title="Главное">
          <NavLink href="/" label="Overview" active={pathname === '/'} onNavigate={onNavigate} />

          {/* Projects — a collapsible disclosure. The label links to the
              /projects grid (clicking it navigates there); the chevron on the
              RIGHT toggles the inline list of active projects so you can jump
              between them without leaving the page. */}
          <div>
            <div className="flex items-stretch gap-0.5">
              <Link
                href="/projects"
                onClick={onNavigate}
                className={`flex-1 px-2 py-1.5 rounded text-sm transition-colors truncate ${
                  pathname === '/projects'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                Projects
              </Link>
              <button
                type="button"
                onClick={() => setProjectsOpen((o) => !o)}
                aria-expanded={projectsOpen}
                aria-label={projectsOpen ? 'Свернуть проекты' : 'Развернуть проекты'}
                className="shrink-0 px-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900"
              >
                <Chevron open={projectsOpen} />
              </button>
            </div>

            {projectsOpen && (
              <div className="mt-0.5 ml-3 pl-2 border-l border-zinc-800 space-y-0.5">
                {activeProjects.length === 0 ? (
                  <div className="px-2 py-1 text-xs text-zinc-600">Нет активных</div>
                ) : (
                  activeProjects.map((p) => (
                    <NavLink
                      key={p.id}
                      href={`/projects/${p.id}`}
                      label={p.name}
                      active={p.id === projectId || p.slug === projectId}
                      onNavigate={onNavigate}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          <NavLink href="/characters" label="Персонажи" active={pathname.startsWith('/characters')} onNavigate={onNavigate} />
          <NavLink href="/voices"     label="Озвучка"   active={pathname.startsWith('/voices')} onNavigate={onNavigate} />
          <NavLink href="/actions"    label="Действия"  active={pathname.startsWith('/actions')} onNavigate={onNavigate} />
          <NavLink href="/releases"   label="Релизы"    active={pathname.startsWith('/releases')} onNavigate={onNavigate} />
          <NavLink href="/projects/archived" label="Архив" active={pathname.startsWith('/projects/archived')} onNavigate={onNavigate} />
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
            <NavLink href={`/projects/${projectId}/scenes`}     label="Акты"      active={pathname.startsWith(`/projects/${projectId}/scenes`) || pathname.startsWith(`/projects/${projectId}/shots`)} onNavigate={onNavigate} />
            <NavLink href={`/projects/${projectId}/tts`}        label="Озвучка"   active={pathname.startsWith(`/projects/${projectId}/tts`)} onNavigate={onNavigate} />
            <NavLink href={`/projects/${projectId}/bgm`}        label="Музыка"    active={pathname.startsWith(`/projects/${projectId}/bgm`)} onNavigate={onNavigate} />
            <NavLink href={`/projects/${projectId}/vo-validation`} label="Озвучка QC" active={pathname.startsWith(`/projects/${projectId}/vo-validation`)} onNavigate={onNavigate} />
            <NavLink href={`/projects/${projectId}/image-qc`}   label="Кадры QC"  active={pathname.startsWith(`/projects/${projectId}/image-qc`)} onNavigate={onNavigate} />
            <NavLink href={`/projects/${projectId}/video-qc`}   label="Видео QC"  active={pathname.startsWith(`/projects/${projectId}/video-qc`)} onNavigate={onNavigate} />
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

/** Right-pointing chevron that rotates down when the section is open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

/**
 * Pull the [id] out of `/projects/[id]/...`. Returns null on any other route,
 * including the reserved `/projects/archived` list (which is not a project id).
 */
function extractProjectId(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  if (!m) return null;
  return RESERVED_PROJECT_SEGMENTS.has(m[1]) ? null : m[1];
}

/** Static segments under /projects/ that are pages, not project ids. */
const RESERVED_PROJECT_SEGMENTS = new Set(['archived']);
