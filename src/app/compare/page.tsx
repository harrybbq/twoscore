import { CompareView } from '@/components/CompareView';
import { DesktopOnly } from '@/components/DesktopOnly';

export const dynamic = 'force-dynamic';

export default function ComparePage() {
  return (
    <DesktopOnly name="Compare">
      <CompareView />
    </DesktopOnly>
  );
}
