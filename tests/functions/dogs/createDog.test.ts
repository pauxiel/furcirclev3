/**
 * Unit tests for POST /dogs
 * Step Function trigger NOT wired here (added in Task 6).
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

// uuid mock — deterministic IDs in tests
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
      authorizer: {
        jwt: { claims: { sub: userId }, scopes: [] },
        principalId: '',
        integrationLatency: 0,
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const validDog = {
  name: 'Buddy',
  breed: 'Golden Retriever',
  ageMonths: 3,
  spayedNeutered: 'not_yet',
  environment: 'Apartment',
};

describe('createDog handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    mockDocClientSend.mockResolvedValue({});
  });

  it('returns 201 with dogId and planStatus=generating', async () => {
    const res = await handler(makeEvent(validDog));
    expect((res as { statusCode: number }).statusCode).toBe(201);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dogId).toBe('test-dog-uuid');
    expect(body.name).toBe('Buddy');
    expect(body.breed).toBe('Golden Retriever');
    expect(body.ageMonths).toBe(3);
    expect(body.planStatus).toBe('generating');
    expect(body.createdAt).toBeDefined();
  });

  it('writes DOG PROFILE to DynamoDB with correct keys', async () => {
    await handler(makeEvent(validDog));

    const profileCall = mockDocClientSend.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK === 'PROFILE',
    );
    expect(profileCall).toBeDefined();
    const item = (profileCall![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect(item['PK']).toBe('DOG#test-dog-uuid');
    expect(item['SK']).toBe('PROFILE');
    expect(item['GSI1PK']).toBe('OWNER#owner-123');
    expect(item['GSI1SK']).toBe('DOG#test-dog-uuid');
    expect(item['ownerId']).toBe('owner-123');
    expect(item['planStatus']).toBe('generating');
  });

  it('returns 400 when name is missing', async () => {
    const { name: _n, ...noName } = validDog;
    const res = await handler(makeEvent(noName));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when breed is missing', async () => {
    const { breed: _b, ...noBreed } = validDog;
    const res = await handler(makeEvent(noBreed));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when ageMonths is missing', async () => {
    const { ageMonths: _a, ...noAge } = validDog;
    const res = await handler(makeEvent(noAge));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when spayedNeutered is invalid', async () => {
    const res = await handler(makeEvent({ ...validDog, spayedNeutered: 'maybe' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when ageMonths exceeds 240', async () => {
    const res = await handler(makeEvent({ ...validDog, ageMonths: 241 }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('writes health record when spayedNeutered=yes', async () => {
    await handler(makeEvent({ ...validDog, spayedNeutered: 'yes' }));

    const healthCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const sk = (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK ?? '';
      return (sk as string).startsWith('HEALTH#');
    });
    expect(healthCall).toBeDefined();
    const item = (healthCall![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect(item['type']).toBe('spayed_neutered');
  });

  it('writes health record for medicalConditions when provided', async () => {
    await handler(makeEvent({ ...validDog, medicalConditions: 'Hip dysplasia' }));

    const healthCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const item = (c[0] as { input?: { Item?: { type?: string } } }).input?.Item;
      return item?.type === 'medical_condition';
    });
    expect(healthCall).toBeDefined();
  });

  it('does NOT write health record when spayedNeutered=not_yet', async () => {
    await handler(makeEvent(validDog)); // spayedNeutered=not_yet

    const healthCalls = mockDocClientSend.mock.calls.filter((c: unknown[]) => {
      const sk = (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK ?? '';
      return (sk as string).startsWith('HEALTH#spayed');
    });
    expect(healthCalls).toHaveLength(0);
  });

  it('derives dateOfBirth from ageMonths', async () => {
    await handler(makeEvent(validDog));
    const profileCall = mockDocClientSend.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { input?: { Item?: { SK?: string } } }).input?.Item?.SK === 'PROFILE',
    );
    const item = (profileCall![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect(item['dateOfBirth']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
