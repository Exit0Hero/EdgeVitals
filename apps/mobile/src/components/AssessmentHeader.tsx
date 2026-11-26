import { BackHeader, ProgressSteps } from './ui';

export function AssessmentHeader({
  kind,
  step,
  onBack,
}: {
  kind: 'morning' | 'evening';
  step: 0 | 1 | 2;
  onBack?: () => void;
}) {
  return (
    <>
      <BackHeader
        title={kind === 'morning' ? 'Morning check-in' : 'Evening check-in'}
        onBack={onBack}
      />
      <ProgressSteps steps={3} current={step} labels={['Check-in', 'Scan', 'Results']} />
    </>
  );
}
