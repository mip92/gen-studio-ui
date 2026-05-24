import { ProjectHeader } from '../../../components/ProjectHeader';
import { API_BASE } from '../../../lib/api';

// Note on URL canonicalisation: the slug→uuid redirect happens in `middleware.ts`
// at the app root, so by the time we hit this layout `params.id` is always a
// UUID. We still call /projects here just to resolve the human-readable name
// for the header.

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params:   Promise<{ id: string }>;
}) {
  const { id } = await params;

  let projectName = id;
  try {
    const res = await fetch(`${API_BASE}/projects`, { cache: 'no-store' });
    if (res.ok) {
      const list: Array<{ id: string; slug: string; name: string }> = await res.json();
      const found = list.find((p) => p.id === id || p.slug === id);
      if (found) projectName = found.name;
    }
  } catch {
    // backend down — fall back to id
  }

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <ProjectHeader id={id} projectName={projectName} />
      {children}
    </div>
  );
}
