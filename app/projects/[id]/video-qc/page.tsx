import { VideoQcPanel } from '../../../../components/VideoQcPanel';

export default async function VideoQcPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VideoQcPanel projectId={id} />;
}
