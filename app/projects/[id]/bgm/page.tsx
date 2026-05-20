import { BgmList } from '../../../../components/BgmList';

export default async function BgmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BgmList projectId={id} />;
}
