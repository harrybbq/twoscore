import { DesktopOnly } from '@/components/DesktopOnly';
import { Setup } from '@/components/Setup';
import { TitleTable } from '@/components/TitleTable';
import { PUBLIC_RATING_SOURCE_LABEL } from '@/lib/env';
import { loadModels } from '@/lib/models/load';
import { dbConfigured } from '@/lib/supabase/server';
import { genreOptions } from '@/lib/titles/query';

export const dynamic = 'force-dynamic';

export default async function TablePage() {
  if (!dbConfigured()) return <Setup missing="db" />;
  if (!(await loadModels())) return <Setup missing="models" />;
  const genres = await genreOptions().catch(() => [] as string[]);
  return (
    <DesktopOnly name="The table">
      <TitleTable genres={genres} publicLabel={PUBLIC_RATING_SOURCE_LABEL()} />
    </DesktopOnly>
  );
}
