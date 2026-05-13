import { ScenesList } from '../../../../components/ScenesList';

export default async function ScenesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ScenesList id={id} />;
}
