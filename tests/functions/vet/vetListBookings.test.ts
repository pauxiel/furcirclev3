const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetListBookings';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (qs: Record<string, string> = {}, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    queryStringParameters: qs,
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const bookingItem = {
  PK: 'BOOKING#booking-1',
  SK: 'BOOKING',
  bookingId: 'booking-1',
  ownerId: 'owner-1',
  vetId: 'vet-123',
  dogId: 'dog-1',
  duration: 30,
  scheduledAt: '2026-05-01T10:00:00Z',
  status: 'upcoming',
  agoraChannelId: 'furcircle-booking-booking-1',
  createdAt: '2026-04-15T10:00:00Z',
  GSI2PK: 'VET#vet-123',
  GSI2SK: 'BOOKING#upcoming#2026-05-01T10:00:00Z',
};

const ownerProfile = { PK: 'OWNER#owner-1', SK: 'PROFILE', userId: 'owner-1', firstName: 'Joshua', lastName: 'Smith' };
const dogProfile = { PK: 'DOG#dog-1', SK: 'PROFILE', dogId: 'dog-1', name: 'Buddy', breed: 'Golden Retriever', ageMonths: 3 };

describe('vetListBookings handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 400 for invalid status param', async () => {
    const res = (await handler(makeEvent({ status: 'invalid' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_STATUS');
  });

  it('returns empty list when no bookings', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).bookings).toHaveLength(0);
  });

  it('returns bookings enriched with owner and dog', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [bookingItem] });
    mockDocClientSend.mockResolvedValueOnce({ Responses: { 'furcircle-test': [ownerProfile, dogProfile] } });

    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.bookings).toHaveLength(1);
    expect(body.bookings[0].owner.firstName).toBe('Joshua');
    expect(body.bookings[0].dog.name).toBe('Buddy');
  });

  it('defaults to upcoming status', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    await handler(makeEvent());
    const callArgs = mockDocClientSend.mock.calls[0][0].input;
    expect(callArgs.ExpressionAttributeValues[':sk']).toBe('BOOKING#upcoming#');
  });
});
