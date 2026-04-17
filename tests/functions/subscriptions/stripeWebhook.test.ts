const mockDocClientSend = jest.fn();
const mockGetStripe = jest.fn();
const mockConstructEvent = jest.fn();
const mockCustomersRetrieve = jest.fn();
const mockSSMSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/stripe', () => ({
  getStripe: () => mockGetStripe(),
}));

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSSMSend(...args) })),
  GetParameterCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

import { handler } from '../../../src/functions/subscriptions/stripeWebhook';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (body: string, sig = 'valid-sig'): APIGatewayProxyEventV2 =>
  ({
    body,
    isBase64Encoded: false,
    headers: { 'stripe-signature': sig },
  } as unknown as APIGatewayProxyEventV2);

const ownerRow = { PK: 'OWNER#owner-123', SK: 'PROFILE', GSI1PK: 'EMAIL#user@test.com', GSI1SK: 'OWNER' };
const subRow = { PK: 'OWNER#owner-123', SK: 'SUBSCRIPTION', plan: 'proactive', creditBalance: 40 };

const periodEndTs = Math.floor(Date.now() / 1000) + 2592000;

describe('stripeWebhook handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSSMSend.mockResolvedValue({ Parameter: { Value: 'whsec_test' } });
    mockGetStripe.mockResolvedValue({
      webhooks: { constructEvent: mockConstructEvent },
      customers: { retrieve: mockCustomersRetrieve },
    });
    mockCustomersRetrieve.mockResolvedValue({ deleted: false, email: 'user@test.com' });
  });

  it('returns 400 for invalid Stripe signature', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('Invalid signature'); });

    const result = (await handler(makeEvent('{}', 'bad-sig'))) as Result;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('INVALID_SIGNATURE');
  });

  it('invoice.payment_succeeded resets creditBalance=70 for proactive owner', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_123' } },
    });
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [ownerRow] })     // findOwnerByEmail (GSI1 query)
      .mockResolvedValueOnce({ Items: [subRow] })        // subscription GetItem
      .mockResolvedValueOnce({});                        // UpdateItem

    const result = (await handler(makeEvent('{}'))) as Result;

    expect(result.statusCode).toBe(200);
    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
    const updateCall = mockDocClientSend.mock.calls[2][0];
    expect(updateCall.input ?? updateCall).toMatchObject(
      expect.objectContaining({ ExpressionAttributeValues: expect.objectContaining({ ':creditBalance': 70 }) }),
    );
  });

  it('invoice.payment_failed sets status=past_due', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_123' } },
    });
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [ownerRow] })
      .mockResolvedValueOnce({});

    const result = (await handler(makeEvent('{}'))) as Result;

    expect(result.statusCode).toBe(200);
    const updateCall = mockDocClientSend.mock.calls[1][0];
    expect(updateCall.input ?? updateCall).toMatchObject(
      expect.objectContaining({ ExpressionAttributeValues: expect.objectContaining({ ':status': 'past_due' }) }),
    );
  });

  it('customer.subscription.updated syncs status and currentPeriodEnd', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          customer: 'cus_123',
          status: 'active',
          items: { data: [{ current_period_end: periodEndTs }] },
        },
      },
    });
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [ownerRow] })
      .mockResolvedValueOnce({});

    const result = (await handler(makeEvent('{}'))) as Result;

    expect(result.statusCode).toBe(200);
    const updateCall = mockDocClientSend.mock.calls[1][0];
    expect(updateCall.input ?? updateCall).toMatchObject(
      expect.objectContaining({ ExpressionAttributeValues: expect.objectContaining({ ':status': 'active' }) }),
    );
  });

  it('customer.subscription.deleted resets to welcome plan', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_123' } },
    });
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [ownerRow] })
      .mockResolvedValueOnce({});

    const result = (await handler(makeEvent('{}'))) as Result;

    expect(result.statusCode).toBe(200);
    const updateCall = mockDocClientSend.mock.calls[1][0];
    expect(updateCall.input ?? updateCall).toMatchObject(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({ ':plan': 'welcome', ':creditBalance': 0 }),
      }),
    );
  });

  it('unknown event type returns 200 no-op', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.created',
      data: { object: {} },
    });

    const result = (await handler(makeEvent('{}'))) as Result;

    expect(result.statusCode).toBe(200);
    expect(mockDocClientSend).not.toHaveBeenCalled();
  });
});
