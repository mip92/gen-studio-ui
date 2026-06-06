import { LoraListPage } from '../../../../../../components/LoraListPage';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; profileId: string }>;
}) {
  const { profileId } = await params;
  return <LoraListPage profileId={profileId} />;
}
