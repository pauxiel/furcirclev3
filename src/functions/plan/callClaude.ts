import { generatePlan } from '../../lib/claude';

interface CallClaudeEvent {
  dogId: string;
  ownerId: string;
  name: string;
  breed: string;
  ageMonths: number;
  spayedNeutered?: string | null;
  medicalConditions?: string | null;
  environment?: string | null;
  [key: string]: unknown;
}

export const handler = async (event: CallClaudeEvent): Promise<Record<string, unknown>> => {
  const planData = await generatePlan({
    dogId: event.dogId,
    breed: event.breed,
    ageMonths: event.ageMonths,
    spayedNeutered: event.spayedNeutered,
    medicalConditions: event.medicalConditions,
    environment: event.environment,
  });

  return {
    ...event,
    ...planData,
  };
};
