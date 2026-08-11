import { BgmBlockDetail } from '../../../../../components/BgmBlockDetail';

export default async function BgmBlockPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const { id, slug } = await params;
  return <BgmBlockDetail projectId={id} slug={slug} />;
}
