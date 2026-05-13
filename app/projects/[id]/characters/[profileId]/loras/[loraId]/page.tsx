import { LoraDetailPage } from '../../../../../../../components/LoraDetailPage';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; profileId: string; loraId: string }>;
}) {
  const { id, profileId, loraId } = await params;
  return <LoraDetailPage projectId={id} profileId={profileId} loraId={loraId} />;
}
