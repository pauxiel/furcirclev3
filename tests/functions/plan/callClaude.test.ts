/**
 * Unit tests for Step Function step: CallClaude
 */

const mockGeneratePlan = jest.fn();

jest.mock('../../../src/lib/claude', () => ({
  generatePlan: (...args: unknown[]) => mockGeneratePlan(...args),
}));

import { handler } from '../../../src/functions/plan/callClaude';

const dogInput = {
  dogId: 'dog-123',
  ownerId: 'owner-123',
  name: 'Buddy',
  breed: 'Golden Retriever',
  ageMonths: 3,
  spayedNeutered: 'not_yet',
  medicalConditions: null,
  environment: 'Apartment',
};

const planData = {
  whatToExpect: 'Peak learning period.',
  whatToDo: [{ text: 'Teach sit', videoTopic: 'basic commands' }],
  whatNotToDo: [{ text: 'No off-leash parks' }],
  watchFor: [{ text: 'Excessive hiding' }],
  earlyWarningSigns: [{ text: 'Persistent limping', action: 'See a vet.' }],
  comingUpNextMonth: 'Month 4 focuses on adolescence.',
  milestones: [
    { emoji: '🐾', title: 'Socialisation', description: 'Critical window closing.' },
    { emoji: '🎓', title: 'Basic commands', description: 'Sit, come, down, stay.' },
    { emoji: '🦷', title: 'Bite inhibition', description: 'Address mouthing.' },
  ],
  wellnessScore: 72,
};

describe('callClaude handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns plan data merged with dog input', async () => {
    mockGeneratePlan.mockResolvedValueOnce(planData);

    const result = (await handler(dogInput)) as Record<string, unknown>;

    expect(result['dogId']).toBe('dog-123');
    expect(result['ownerId']).toBe('owner-123');
    expect(result['wellnessScore']).toBe(72);
    expect(result['whatToExpect']).toBe('Peak learning period.');
    expect(result['milestones']).toHaveLength(3);
  });

  it('calls generatePlan with dog profile', async () => {
    mockGeneratePlan.mockResolvedValueOnce(planData);

    await handler(dogInput);

    expect(mockGeneratePlan).toHaveBeenCalledWith(
      expect.objectContaining({ dogId: 'dog-123', breed: 'Golden Retriever', ageMonths: 3 }),
    );
  });

  it('throws when generatePlan fails', async () => {
    mockGeneratePlan.mockRejectedValueOnce(new Error('Claude API timeout'));

    await expect(handler(dogInput)).rejects.toThrow('Claude API timeout');
  });
});
