import { ProjectHeader } from '../../../components/ProjectHeader';
import { getProjects } from '../../../lib/projects';

// Note on URL canonicalisation: the slug→uuid redirect happens in `middleware.ts`
// at the app root, so by the time we hit this layout `params.id` is always a
// UUID. We resolve the human-readable name for the header from the shared
// project list — getProjects() is React.cache'd, so this reuses the same fetch
// the sidebar already made this render (no extra round-trip).

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params:   Promise<{ id: string }>;
}) {
  const { id } = await params;

  const projects = await getProjects();
  const found = projects.find((p) => p.id === id || p.slug === id);
  const projectName = found?.name ?? id;

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <ProjectHeader id={id} projectName={projectName} />
      {children}
    </div>
  );
}
