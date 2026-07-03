// Server-side project data access. Keep imports of this module on the server
// (layouts / server pages) only — it exists so the whole tree resolves the
// project list from ONE backend round-trip per render.
//
// `React.cache` memoizes the fetch for the duration of a single server render,
// so the root layout (sidebar), the /projects[/archived] pages, and the
// per-project layout header all share the same result instead of each firing
// their own request — the redundant-fetch problem the old client `useEffect`
// sidebar had. Memoization is per-request only; a new render fetches fresh.

import { cache } from 'react';
import { api, ProjectListItem, isProjectArchived } from './api';

/**
 * The full project list, fetched once per server render. Degrades to an empty
 * list if the backend is unreachable so the shell (sidebar, pages) still
 * renders instead of throwing — matching the old `.catch(() => [])` behaviour.
 */
export const getProjects = cache(async (): Promise<ProjectListItem[]> => {
  try {
    return await api.listProjects();
  } catch {
    return [];
  }
});

/** Active (in-production) projects — no published YouTube link yet. */
export async function getActiveProjects(): Promise<ProjectListItem[]> {
  return (await getProjects()).filter((p) => !isProjectArchived(p));
}

/** Archived (done) projects — a published YouTube link marks them finished. */
export async function getArchivedProjects(): Promise<ProjectListItem[]> {
  return (await getProjects()).filter(isProjectArchived);
}
