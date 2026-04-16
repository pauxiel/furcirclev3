/**
 * Unit tests for triggerMonthlyRefresh (EventBridge monthly cron)
 */

const mockDocClientSend = jest.fn();
const mockSfnSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSfnSend(...args) })),
  StartExecutionCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { handler } from '../../../src/functions/plan/triggerMonthlyRefresh';

const makePlanItem = (dogId: string, month: string) => ({
  PK: `DOG#${dogId}`,
  SK: `PLAN#${month}`,
  GSI1PK: `PLAN#${month}`,
  GSI1SK: `DOG#${dogId}`,
  dogId,
  ownerId: `owner-${dogId}`,
  month,
});

describe('triggerMonthlyRefresh handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['STATE_MACHINE_ARN'] = 'arn:aws:states:us-east-1:123:stateMachine:furcircle-generate-plan-dev';
  });

  it('queries GSI1 with prevMonth and starts executions for each dog', async () => {
    const prevMonth = getPrevMonth();
    mockDocClientSend.mockResolvedValueOnce({
      Items: [makePlanItem('dog-1', prevMonth), makePlanItem('dog-2', prevMonth)],
    });
    mockSfnSend.mockResolvedValue({ executionArn: 'arn:...' });

    const result = await handler({} as never);
    expect(mockSfnSend).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ processed: 2, succeeded: 2, failed: 0 });
  });

  it('uses prevMonth (not current month) for GSI1 query', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    await handler({} as never);

    const queryCall = mockDocClientSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    const values = Object.values(queryCall.input.ExpressionAttributeValues) as string[];
    const prevMonth = getPrevMonth();
    expect(values.some((v) => v.includes(prevMonth))).toBe(true);
    expect(values.some((v) => v.includes(getCurrentMonth()))).toBe(false);
  });

  it('returns zero counts when no dogs found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler({} as never);
    expect(result).toMatchObject({ processed: 0, succeeded: 0, failed: 0 });
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('continues processing when one SFN start fails (Promise.allSettled)', async () => {
    const prevMonth = getPrevMonth();
    mockDocClientSend.mockResolvedValueOnce({
      Items: [makePlanItem('dog-1', prevMonth), makePlanItem('dog-2', prevMonth), makePlanItem('dog-3', prevMonth)],
    });
    mockSfnSend
      .mockResolvedValueOnce({ executionArn: 'arn:1' })
      .mockRejectedValueOnce(new Error('SFN throttle'))
      .mockResolvedValueOnce({ executionArn: 'arn:3' });

    const result = await handler({} as never);
    expect(result).toMatchObject({ processed: 3, succeeded: 2, failed: 1 });
  });

  it('handles paginated GSI1 results (LastEvaluatedKey)', async () => {
    const prevMonth = getPrevMonth();
    mockDocClientSend
      .mockResolvedValueOnce({
        Items: [makePlanItem('dog-1', prevMonth)],
        LastEvaluatedKey: { PK: 'DOG#dog-1', SK: `PLAN#${prevMonth}` },
      })
      .mockResolvedValueOnce({
        Items: [makePlanItem('dog-2', prevMonth)],
      });
    mockSfnSend.mockResolvedValue({ executionArn: 'arn:...' });

    const result = await handler({} as never);
    expect(mockDocClientSend).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ processed: 2, succeeded: 2, failed: 0 });
  });
});

function getPrevMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
