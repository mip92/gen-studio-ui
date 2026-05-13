import { CharactersList } from '../../../../components/CharactersList';

export default async function CharactersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CharactersList id={id} />;
}
