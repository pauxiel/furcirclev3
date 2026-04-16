/**
 * Unit tests for Step Function step: HandlePlanError
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/plan/handlePlanError';

describe('handlePlanError handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    mockDocClientSend.mockResolvedValue({});
  });

  it('updates dog planStatus to failed', async () => {
    await handler({ dogId: 'dog-123', error: 'Claude API timeout' });

    expect(mockDocClientSend).toHaveBeenCalledTimes(1);
    const cmd = mockDocClientSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, unknown> };
    };
    const values = Object.values(cmd.input.ExpressionAttributeValues);
    expect(values).toContain('failed');
  });

  it('returns input with planStatus=failed', async () => {
    const result = (await handler({ dogId: 'dog-123', error: 'timeout' })) as Record<string, unknown>;
    expect(result['dogId']).toBe('dog-123');
    expect(result['planStatus']).toBe('failed');
  });
});
