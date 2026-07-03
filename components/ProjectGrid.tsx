import Link from 'next/link';
import { ProjectListItem, isProjectArchived } from '../lib/api';

/**
 * Shared responsive grid of project cards, used by both /projects (active) and
 * /projects/archived. Purely presentational (no client state) so it renders as
 * a Server Component. Archived cards surface a "▶ YouTube" badge linking to the
 * published video.
 */
export function ProjectGrid({ projects }: { projects: ProjectListItem[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}

function ProjectCard({ project: p }: { project: ProjectListItem }) {
  const archived = isProjectArchived(p);

  return (
    <Link
      href={`/projects/${p.id}`}
      className="block bg-zinc-900 border border-zinc-800 hover:border-blue-700 hover:bg-zinc-800/50 rounded-lg p-5 transition"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-medium text-lg">{p.name}</h3>
          <p className="text-xs text-zinc-500 font-mono">{p.slug}</p>
        </div>
        <span className="text-zinc-600 text-xl">→</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Visual style badge — drives which identity pipeline (LoRA vs anchor)
            and which workflows are available. See docs/VISUAL_STYLE_ARCHITECTURE.md. */}
        {p.visualStyle && (
          <span
            className={`inline-block px-2 py-0.5 text-[10px] font-mono rounded ${
              p.visualStyle === 'photoreal_cinematic'
                ? 'bg-amber-900/40 text-amber-300 border border-amber-800'
                : 'bg-purple-900/40 text-purple-300 border border-purple-800'
            }`}
            title="Visual style — drives workflow + identity pipeline"
          >
            {p.visualStyle}
          </span>
        )}
        {archived && (
          <span
            className="inline-block px-2 py-0.5 text-[10px] font-mono rounded bg-green-900/40 text-green-300 border border-green-800"
            title="Опубликовано на YouTube — проект завершён"
          >
            ▶ YouTube
          </span>
        )}
      </div>

      <p className="text-xs text-zinc-500 mt-3">
        {archived ? 'Проект завершён и опубликован' : 'Открыть dashboard персонажей и LoRA'}
      </p>
    </Link>
  );
}
