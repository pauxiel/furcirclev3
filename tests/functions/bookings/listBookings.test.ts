const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/bookings/listBookings';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  params: Record<string, string> = {},
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: {},
    queryStringParameters: Object.keys(params).length ? params : undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const bookingRow = {
  PK: 'BOOKING#booking-1',
  SK: 'BOOKING',
  GSI1PK: 'OWNER#owner-123',
  GSI1SK: 'BOOKING#upcoming#2026-04-18T10:00:00Z',
  bookingId: 'booking-1',
  ownerId: 'owner-123',
  vetId: 'vet-123',
  dogId: 'dog-123',
  duration: 30,
  scheduledAt: '2026-04-18T10:00:00Z',
  status: 'upcoming',
  creditsDeducted: 30,
  agoraChannelId: 'furcircle-booking-booking-1',
  createdAt: '2026-04-15T10:00:00Z',
};

const vetProfile = { PK: 'VET#vet-123', SK: 'PROFILE', vetId: 'vet-123', firstName: 'Emma', lastName: 'Clarke', providerType: 'behaviourist', photoUrl: null };
const dogProfile = { PK: 'DOG#dog-123', SK: 'PROFILE', dogId: 'dog-123', name: 'Buddy', breed: 'Golden Retriever' };

describe('listBookings handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with bookings including vet and dog', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [bookingRow] })
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [vetProfile, dogProfile] } });

    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.bookings).toHaveLength(1);
    expect(body.bookings[0].vet.firstName).toBe('Emma');
    expect(body.bookings[0].dog.name).toBe('Buddy');
  });

  it('queries GSI1 with BOOKING#upcoming prefix when status=upcoming', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent({ status: 'upcoming' }));

    const queryCall = mockDocClientSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    expect(queryCall.input.ExpressionAttributeValues[':prefix']).toBe('BOOKING#upcoming');
  });

  it('queries GSI1 with BOOKING#completed prefix when status=past', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent({ status: 'past' }));

    const queryCall = mockDocClientSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    expect(queryCall.input.ExpressionAttributeValues[':prefix']).toBe('BOOKING#completed');
  });

  it('returns empty bookings array when owner has no bookings', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const res = (await handler(makeEvent())) as Result;
    const body = JSON.parse(res.body);
    expect(body.bookings).toEqual([]);
  });
});
