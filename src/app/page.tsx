import { Feed } from '@/components/Feed';
import { Setup } from '@/components/Setup';
import { PUBLIC_RATING_SOURCE_LABEL } from '@/lib/env';
import { loadModels } from '@/lib/models/load';
import { dbConfigured } from '@/lib/supabase/server';
import { genreOptions } from '@/lib/titles/query';

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  if (!dbConfigured()) return <Setup missing="db" />;
  const models = await loadModels();
  if (!models) return <Setup missing="models" />;

  let genres: string[] = [];
  try {
    genres = await genreOptions();
  } catch {
    return <Setup missing="db" />;
  }

  return (
    <>
      <div className="hidden pb-1 md:block">
        <p className="text-2xs text-ink-500">
          Score B is the probability you go back to it. Score A is how much you would admire it.
          They are different variables — in your history they correlate 0.26.
        </p>
      </div>
      <Feed genres={genres} publicLabel={PUBLIC_RATING_SOURCE_LABEL()} />
    </>
  );
}
