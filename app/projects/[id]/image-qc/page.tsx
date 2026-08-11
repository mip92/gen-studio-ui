import { ImageQcPanel } from '../../../../components/ImageQcPanel';

export default async function ImageQcPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ImageQcPanel projectId={id} />;
}
