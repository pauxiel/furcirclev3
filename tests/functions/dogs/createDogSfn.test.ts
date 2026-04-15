/**
 * Unit tests for createDog → Step Functions trigger (Task 6 addition)
 */

const mockDocClientSend = jest.fn();
const mockSfnClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: (...args: unknown[]) => mockSfnClientSend(...args) })),
  StartExecutionCommand: jest.fn((input: unknown) => ({ input })),
}));

jest.mock('uuid', () => ({ v4: () => 'test-dog-uuid' }));

import { handler } from '../../../src/functions/dogs/createDog';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  body: Record<string, unknown>,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const validDog = {
  name: 'Buddy',
  breed: 'Golden Retriever',
  ageMonths: 3,
  spayedNeutered: 'not_yet',
  environment: 'Apartment',
};

describe('createDog SFN trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['PLAN_STATE_MACHINE_ARN'] = 'arn:aws:states:us-east-1:123:stateMachine:furcircle-generate-plan-dev';
    mockDocClientSend.mockResolvedValue({});
    mockSfnClientSend.mockResolvedValue({ executionArn: 'arn:execution' });
  });

  it('starts Step Function execution after dog creation', async () => {
    await handler(makeEvent(validDog));

    expect(mockSfnClientSend).toHaveBeenCalledTimes(1);
  });

  it('passes dogId and dog data to Step Function input', async () => {
    await handler(makeEvent(validDog));

    const cmd = mockSfnClientSend.mock.calls[0][0] as { input: { input: string; stateMachineArn: string } };
    const sfnInput = JSON.parse(cmd.input.input) as Record<string, unknown>;
    expect(sfnInput['dogId']).toBe('test-dog-uuid');
    expect(sfnInput['breed']).toBe('Golden Retriever');
    expect(sfnInput['ageMonths']).toBe(3);
    expect(cmd.input.stateMachineArn).toBe(
      'arn:aws:states:us-east-1:123:stateMachine:furcircle-generate-plan-dev',
    );
  });

  it('still returns 201 even if SFN start fails (non-blocking)', async () => {
    mockSfnClientSend.mockRejectedValueOnce(new Error('SFN unavailable'));

    const res = await handler(makeEvent(validDog));
    // createDog should still succeed — SFN is fire-and-forget
    expect((res as { statusCode: number }).statusCode).toBe(201);
  });
});
