import { AffinityExplorer } from '@/components/AffinityExplorer';
import { DesktopOnly } from '@/components/DesktopOnly';
import { Setup } from '@/components/Setup';
import { dbConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default function AffinitiesPage() {
  if (!dbConfigured()) return <Setup missing="db" />;
  return (
    <DesktopOnly name="The affinity explorer">
      <AffinityExplorer />
    </DesktopOnly>
  );
}
