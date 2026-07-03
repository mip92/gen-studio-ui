import Link from 'next/link';
import { getArchivedProjects } from '../../../lib/projects';
import { PageHeader } from '../../../components/PageHeader';
import { ProjectGrid } from '../../../components/ProjectGrid';

// Server Component. Archived = projects with a published YouTube link (see
// isProjectArchived). Static `archived` segment takes precedence over the
// `[id]` dynamic route, so this page — not the project page — renders here.
export default async function ArchivedProjectsPage() {
  const projects = await getArchivedProjects();

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <PageHeader
        crumbs={[{ label: 'Overview', href: '/' }, { label: 'Projects', href: '/projects' }, { label: 'Архив' }]}
        title="Архив проектов"
        subtitle="Завершённые проекты с опубликованным видео на YouTube."
        actions={
          <Link href="/projects" className="text-sm text-zinc-400 hover:text-zinc-100 shrink-0">
            ← Проекты
          </Link>
        }
      />

      <main className="p-4 sm:p-8">
        {projects.length === 0 ? (
          <p className="text-zinc-500">Архив пуст — ни один проект ещё не опубликован.</p>
        ) : (
          <ProjectGrid projects={projects} />
        )}
      </main>
    </div>
  );
}
