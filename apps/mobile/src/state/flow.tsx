import type { SessionResult } from '@edgevitals/measurement';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** Onboarding answers kept across screens so back navigation never loses input (FR-033). */
export interface OnboardingDraft {
  consents: {
    processing: boolean;
    wellness_acknowledgement: boolean;
    anonymous_improvement: boolean;
  };
  profile: {
    birth_year: string;
    sex_at_birth: 'female' | 'male' | null;
    height_cm: string;
    weight_kg: string;
  };
  schedule: {
    morning_time: string;
    evening_time: string;
    heart_rate_affecting_substance: 'no' | 'yes' | 'skip' | null;
  };
}

export interface AssessmentDraft {
  kind: 'morning' | 'evening';
  idempotencyKey: string;
  scheduledFor: string;
  assessmentId: string | null;
  sleep: number | null;
  energy: number | null;
  stress: number | null;
  alcohol: boolean | null;
  result: SessionResult | null;
}

interface FlowValue {
  onboarding: OnboardingDraft;
  setOnboarding: (f: (d: OnboardingDraft) => OnboardingDraft) => void;
  assessment: AssessmentDraft | null;
  setAssessment: (f: (d: AssessmentDraft | null) => AssessmentDraft | null) => void;
}

const initialOnboarding: OnboardingDraft = {
  consents: { processing: false, wellness_acknowledgement: false, anonymous_improvement: false },
  profile: { birth_year: '', sex_at_birth: null, height_cm: '', weight_kg: '' },
  schedule: { morning_time: '07:15', evening_time: '21:00', heart_rate_affecting_substance: null },
};

const Ctx = createContext<FlowValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [onboarding, setO] = useState(initialOnboarding);
  const [assessment, setA] = useState<AssessmentDraft | null>(null);
  const v = useMemo(
    () => ({ onboarding, setOnboarding: setO, assessment, setAssessment: setA }),
    [onboarding, assessment],
  );
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useFlow(): FlowValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFlow outside FlowProvider');
  return v;
}
