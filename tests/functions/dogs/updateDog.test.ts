/**
 * Unit tests for PUT /dogs/{dogId}
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/dogs/updateDog';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  dogId: string,
  body: Record<string, unknown>,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { dogId },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const dogProfile = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  ownerId: 'owner-123',
  name: 'Buddy',
  breed: 'Golden Retriever',
  ageMonths: 3,
  planStatus: 'ready',
};

describe('updateDog handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with updated dog', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile }) // GetItem ownership check
      .mockResolvedValueOnce({ Attributes: { ...dogProfile, name: 'Buddy Jr', updatedAt: '2026-04-15T12:00:00Z' } }); // UpdateItem

    const res = await handler(makeEvent('dog-123', { name: 'Buddy Jr' }));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.name).toBe('Buddy Jr');
  });

  it('returns 403 when dog belongs to different owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...dogProfile, ownerId: 'other' } });

    const res = await handler(makeEvent('dog-123', { name: 'Hacked' }, 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('FORBIDDEN');
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('missing', { name: 'X' }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns 400 when no valid fields provided', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: dogProfile });

    const res = await handler(makeEvent('dog-123', { planStatus: 'hacked' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('does not update planStatus or ownerId (not in allowed fields)', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Attributes: dogProfile });

    await handler(makeEvent('dog-123', { name: 'Buddy', planStatus: 'ready', ownerId: 'attacker' }));

    const updateCmd = mockDocClientSend.mock.calls[1][0] as {
      input: { ExpressionAttributeNames: Record<string, string> };
    };
    const writtenFields = Object.values(updateCmd.input.ExpressionAttributeNames);
    expect(writtenFields).not.toContain('planStatus');
    expect(writtenFields).not.toContain('ownerId');
    expect(writtenFields).toContain('name');
  });
});
