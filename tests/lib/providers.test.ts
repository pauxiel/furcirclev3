const mockDocClientSend = jest.fn();

jest.mock('../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { listActiveVeterinarians } from '../../src/lib/providers';

beforeEach(() => {
  mockDocClientSend.mockReset();
});

describe('listActiveVeterinarians', () => {
  it('queries GSI3 for the veterinarian provider type', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [{ vetId: 'v1', isActive: true }] });

    await listActiveVeterinarians('furcircle-test');

    const cmd = mockDocClientSend.mock.calls[0][0];
    const input = (cmd.input ?? cmd) as Record<string, any>;
    expect(input.IndexName).toBe('GSI3');
    expect(input.ExpressionAttributeValues[':pk']).toBe('PROVIDER_TYPE#veterinarian');
  });

  it('excludes inactive vets', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Items: [
        { vetId: 'v1', isActive: true },
        { vetId: 'v2', isActive: false },
        { vetId: 'v3' }, // missing flag = treated active
      ],
    });

    const vets = await listActiveVeterinarians('furcircle-test');
    expect(vets.map((v) => v.vetId)).toEqual(['v1', 'v3']);
  });

  it('returns empty array when none', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    expect(await listActiveVeterinarians('furcircle-test')).toEqual([]);
  });
});
