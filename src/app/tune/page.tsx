import { DesktopOnly } from '@/components/DesktopOnly';
import { TuneSandbox } from '@/components/TuneSandbox';

export const dynamic = 'force-dynamic';

export default function TunePage() {
  return (
    <DesktopOnly name="The tuning sandbox">
      <TuneSandbox />
    </DesktopOnly>
  );
}
