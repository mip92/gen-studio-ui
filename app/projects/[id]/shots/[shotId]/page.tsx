import { ShotDetail } from '../../../../../components/ShotDetail';

export default async function ShotDetailPage({
  params,
}: {
  params: Promise<{ id: string; shotId: string }>;
}) {
  const { id, shotId } = await params;
  return <ShotDetail projectId={id} shotId={shotId} />;
}
