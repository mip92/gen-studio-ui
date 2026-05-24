import { ProjectCharactersPicker } from '@/components/ProjectCharactersPicker';

export default async function CharactersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectCharactersPicker projectSlug={id} />;
}
