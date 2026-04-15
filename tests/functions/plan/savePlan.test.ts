/**
 * Unit tests for Step Function step: SavePlan
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/plan/savePlan';

const planInput = {
  dogId: 'dog-123',
  ownerId: 'owner-123',
  name: 'Buddy',
  breed: 'Golden Retriever',
  ageMonths: 3,
  whatToExpect: 'Peak learning period.',
  whatToDo: [{ text: 'Teach sit' }],
  whatNotToDo: [{ text: 'No off-leash parks' }],
  watchFor: [{ text: 'Excessive hiding' }],
  earlyWarningSigns: [{ text: 'Persistent limping', action: 'See a vet.' }],
  comingUpNextMonth: 'Month 4 focuses on adolescence.',
  milestones: [
    { emoji: '🐾', title: 'Socialisation', description: 'Critical window.' },
    { emoji: '🎓', title: 'Basic commands', description: 'Sit, come, down.' },
    { emoji: '🦷', title: 'Bite inhibition', description: 'Address mouthing.' },
  ],
  wellnessScore: 72,
};

describe('savePlan handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    mockDocClientSend.mockResolvedValue({});
  });

  it('writes PLAN record to DynamoDB with correct keys', async () => {
    await handler(planInput);

    const planPut = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const sk = (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK ?? '';
      return (sk as string).startsWith('PLAN#');
    });
    expect(planPut).toBeDefined();
    const item = (planPut![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect(item['PK']).toBe('DOG#dog-123');
    expect(item['wellnessScore']).toBe(72);
    expect(item['whatToExpect']).toBe('Peak learning period.');
  });

  it('updates dog planStatus to ready and wellnessScore', async () => {
    await handler(planInput);

    const updateCmd = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const input = (c[0] as { input?: { UpdateExpression?: string } }).input;
      return input?.UpdateExpression !== undefined;
    });
    expect(updateCmd).toBeDefined();
    const input = (updateCmd![0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }).input;
    const values = Object.values(input.ExpressionAttributeValues);
    expect(values).toContain('ready');
    expect(values).toContain(72);
  });

  it('writes PLAN SK with current month', async () => {
    await handler(planInput);

    const planPut = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const sk = (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK ?? '';
      return (sk as string).startsWith('PLAN#');
    });
    const sk = (planPut![0] as { input: { Item: { SK: string } } }).input.Item.SK;
    expect(sk).toMatch(/^PLAN#\d{4}-\d{2}$/);
  });

  it('returns input with planStatus=ready', async () => {
    const result = (await handler(planInput)) as Record<string, unknown>;
    expect(result['dogId']).toBe('dog-123');
    expect(result['planStatus']).toBe('ready');
  });
});
