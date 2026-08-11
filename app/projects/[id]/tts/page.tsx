import { ProjectTTSPage } from '../../../../components/ProjectTTSPage';

export default async function TTSPage({
  params,
  searchParams,
}: {
  params:       Promise<{ id: string }>;
  searchParams: Promise<{ scene?: string }>;
}) {
  const { id }    = await params;
  const { scene } = await searchParams;
  return <ProjectTTSPage projectId={id} initialSceneId={scene ?? null} />;
}
