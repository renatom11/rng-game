import { RaceClient } from '@/components/RaceClient';

export default async function RacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <RaceClient slug={slug} />;
}
