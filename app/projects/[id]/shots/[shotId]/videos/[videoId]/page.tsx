import { VideoDetail } from '../../../../../../../components/VideoDetail';

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string; shotId: string; videoId: string }>;
}) {
  const { id, shotId, videoId } = await params;
  return <VideoDetail projectId={id} shotId={shotId} videoId={videoId} />;
}
