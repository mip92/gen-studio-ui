import { VoValidationPanel } from '../../../../components/VoValidationPanel';

export default async function VoValidationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VoValidationPanel projectId={id} />;
}
