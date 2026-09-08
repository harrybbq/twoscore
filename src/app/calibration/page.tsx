import { CalibrationView } from '@/components/CalibrationView';
import { DesktopOnly } from '@/components/DesktopOnly';

export const dynamic = 'force-dynamic';

export default function CalibrationPage() {
  return (
    <DesktopOnly name="Calibration">
      <CalibrationView />
    </DesktopOnly>
  );
}
