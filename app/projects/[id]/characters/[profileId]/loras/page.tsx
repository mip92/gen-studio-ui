import { LoraListPage } from '../../../../../../components/LoraListPage';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; profileId: string }>;
}) {
  const { id, profileId } = await params;
  return <LoraListPage projectId={id} profileId={profileId} />;
}
