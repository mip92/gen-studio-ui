import Link from 'next/link';
import { getActiveProjects } from '../../lib/projects';
import { PageHeader } from '../../components/PageHeader';
import { ProjectGrid } from '../../components/ProjectGrid';

// Server Component: the project list is fetched server-side (deduped with the
// sidebar via React.cache) and filtered to in-production projects. Finished
// ones live under /projects/archived.
export default async function ProjectsListPage() {
  const projects = await getActiveProjects();

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <PageHeader
        crumbs={[{ label: 'Overview', href: '/' }, { label: 'Projects' }]}
        title="Проекты"
        actions={
          <Link href="/projects/archived" className="text-sm text-zinc-400 hover:text-zinc-100 shrink-0">
            Архив →
          </Link>
        }
      />

      <main className="p-4 sm:p-8">
        {projects.length === 0 ? (
          <p className="text-zinc-500">Нет активных проектов. Загляните в <Link href="/projects/archived" className="text-blue-400 hover:underline">архив</Link>.</p>
        ) : (
          <ProjectGrid projects={projects} />
        )}
      </main>
    </div>
  );
}
