import { CharacterPageShell } from '@/components/CharacterPageShell';

export default async function CharacterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; profileId: string }>;
}) {
  const { id, profileId } = await params;
  return (
    <CharacterPageShell projectId={id} profileId={profileId}>
      {children}
    </CharacterPageShell>
  );
}
