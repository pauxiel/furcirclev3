/**
 * Unit tests for Step Function step: ValidateInput
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/plan/validateInput';

const dogProfile = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  ownerId: 'owner-123',
  name: 'Buddy',
  breed: 'Golden Retriever',
  ageMonths: 3,
  spayedNeutered: 'not_yet',
  medicalConditions: null,
  environment: 'Apartment',
  planStatus: 'generating',
};

describe('validateInput handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns dog data when dog exists', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: dogProfile });

    const result = await handler({ dogId: 'dog-123' });

    expect(result).toMatchObject({
      dogId: 'dog-123',
      breed: 'Golden Retriever',
      ageMonths: 3,
      ownerId: 'owner-123',
    });
  });

  it('throws when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    await expect(handler({ dogId: 'missing' })).rejects.toThrow('DOG_NOT_FOUND');
  });

  it('passes medicalConditions and environment through', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { ...dogProfile, medicalConditions: 'Hip dysplasia', environment: 'House with garden' },
    });

    const result = (await handler({ dogId: 'dog-123' })) as Record<string, unknown>;
    expect(result['medicalConditions']).toBe('Hip dysplasia');
    expect(result['environment']).toBe('House with garden');
  });
});
