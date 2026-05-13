import { CharacterDetail } from '../../../../../components/CharacterDetail';

export default async function CharacterDetailPage({
  params,
}: {
  params: Promise<{ id: string; profileId: string }>;
}) {
  const { id, profileId } = await params;
  return <CharacterDetail projectId={id} profileId={profileId} />;
}
