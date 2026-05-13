import { ProjectOverview } from '../../../components/ProjectOverview';

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectOverview id={id} />;
}
