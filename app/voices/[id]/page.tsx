import { VoiceoverDetail } from '../../../components/VoiceoverDetail';

export default async function VoiceoverDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VoiceoverDetail id={id} />;
}
