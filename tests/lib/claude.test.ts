/**
 * Unit tests for src/lib/claude.ts — generatePlan shape contract
 */

const mockMessagesCreate = jest.fn();
const mockSsmSend = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => mockMessagesCreate(...args) },
  })),
}));

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSsmSend(...args) })),
  GetParameterCommand: jest.fn(),
}));

import { generatePlan } from '../../src/lib/claude';

const mockPlanResponse = {
  whatToExpect: 'Peak learning period. Critical socialisation window is open.',
  whatToDo: [
    {
      stepId: 'basic-commands',
      title: 'Basic Commands',
      text: 'Teach sit and stay using positive reinforcement.',
      videoTopic: 'puppy basics',
      steps: [
        { frequency: 'Three times daily', title: 'Teach sit using treat lure', text: 'Hold treat above nose and move back.' },
        { frequency: 'Daily', title: 'Reinforce name recognition', text: 'Say name once, reward eye contact.' },
      ],
    },
    {
      stepId: 'socialisation-walks',
      title: 'Socialisation Walks',
      text: 'Expose to varied environments and sounds.',
      steps: [
        { frequency: 'Daily', title: 'Walk new routes', text: 'Try different surfaces and environments.' },
        { frequency: 'Weekly', title: 'Meet friendly dogs', text: 'Controlled greetings only.' },
      ],
    },
  ],
  whatNotToDo: [{ text: 'No off-leash parks until recall is solid' }],
  watchFor: [{ text: 'Excessive hiding or fearfulness' }],
  earlyWarningSigns: [{ text: 'Persistent limping', action: 'Visit a vet within 24h.' }],
  comingUpNextMonth: 'Month 4 focuses on adolescence and impulse control.',
  milestones: [
    { emoji: '🐾', title: 'Socialisation', description: 'Critical window open.' },
    { emoji: '🎓', title: 'Basic commands', description: 'Sit, come, stay.' },
    { emoji: '🦷', title: 'Bite inhibition', description: 'Address mouthing now.' },
  ],
  wellnessScore: 72,
};

const dogProfile = { dogId: 'dog-1', breed: 'Golden Retriever', ageMonths: 3 };

describe('generatePlan', () => {
  beforeEach(() => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: 'test-api-key' } });
    process.env['STAGE'] = 'test';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns whatToDo items each with stepId', async () => {
    mockMessagesCreate.mockResolvedValueOnce({ content: [{ text: JSON.stringify(mockPlanResponse) }] });

    const result = await generatePlan(dogProfile);

    result.whatToDo.forEach((item) => {
      expect(typeof item.stepId).toBe('string');
      expect(item.stepId.length).toBeGreaterThan(0);
    });
  });

  it('returns whatToDo items each with steps array of 2+ items', async () => {
    mockMessagesCreate.mockResolvedValueOnce({ content: [{ text: JSON.stringify(mockPlanResponse) }] });

    const result = await generatePlan(dogProfile);

    result.whatToDo.forEach((item) => {
      expect(Array.isArray(item.steps)).toBe(true);
      expect(item.steps.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('stepId values are unique within a plan', async () => {
    mockMessagesCreate.mockResolvedValueOnce({ content: [{ text: JSON.stringify(mockPlanResponse) }] });

    const result = await generatePlan(dogProfile);

    const ids = result.whatToDo.map((item) => item.stepId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each step has frequency, title, text', async () => {
    mockMessagesCreate.mockResolvedValueOnce({ content: [{ text: JSON.stringify(mockPlanResponse) }] });

    const result = await generatePlan(dogProfile);

    result.whatToDo.forEach((item) => {
      item.steps.forEach((step) => {
        expect(typeof step.frequency).toBe('string');
        expect(typeof step.title).toBe('string');
        expect(typeof step.text).toBe('string');
      });
    });
  });

  it('strips markdown code fences and parses correctly', async () => {
    const fenced = '```json\n' + JSON.stringify(mockPlanResponse) + '\n```';
    mockMessagesCreate.mockResolvedValueOnce({ content: [{ text: fenced }] });

    const result = await generatePlan(dogProfile);
    expect(result.wellnessScore).toBe(72);
    expect(result.whatToDo).toHaveLength(2);
  });
});
