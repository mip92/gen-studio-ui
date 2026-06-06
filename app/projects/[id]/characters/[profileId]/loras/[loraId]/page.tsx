import { LoraDetailPage } from '../../../../../../../components/LoraDetailPage';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; profileId: string; loraId: string }>;
}) {
  const { profileId, loraId } = await params;
  return <LoraDetailPage profileId={profileId} loraId={loraId} />;
}
