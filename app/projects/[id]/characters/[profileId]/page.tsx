import { redirect } from 'next/navigation';

export default async function CharacterRootPage({
  params,
}: {
  params: Promise<{ id: string; profileId: string }>;
}) {
  const { id, profileId } = await params;
  redirect(`/projects/${id}/characters/${profileId}/description`);
}
