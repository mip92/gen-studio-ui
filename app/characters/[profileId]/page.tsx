import { redirect } from 'next/navigation';

export default async function CharacterRootPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  redirect(`/characters/${profileId}/description`);
}
