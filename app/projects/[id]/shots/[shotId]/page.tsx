import { redirect } from 'next/navigation';

export default async function ShotRootPage({
  params,
}: {
  params: Promise<{ id: string; shotId: string }>;
}) {
  const { id, shotId } = await params;
  redirect(`/projects/${id}/shots/${shotId}/prompts`);
}
