import { ProjectHeader } from '../../../components/ProjectHeader';
import { API_BASE } from '../../../lib/api';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params:   Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Resolve human-readable project name (id may also be a legacy slug).
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <ProjectHeader id={id} projectName={projectName} />
      {children}
    </div>
  );
}
