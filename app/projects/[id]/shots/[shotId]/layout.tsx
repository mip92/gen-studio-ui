import { ShotPageShell } from '@/components/ShotPageShell';

export default async function ShotLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; shotId: string }>;
}) {
  const { id, shotId } = await params;
  return (
    <ShotPageShell projectId={id} shotId={shotId}>
      {children}
    </ShotPageShell>
  );
}
