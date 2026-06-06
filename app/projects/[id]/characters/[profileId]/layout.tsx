import { CharacterPageShell } from '@/components/CharacterPageShell';

export default async function CharacterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; profileId: string }>;
}) {
  const { profileId } = await params;
  return (
    <CharacterPageShell profileId={profileId}>
      {children}
    </CharacterPageShell>
  );
}
