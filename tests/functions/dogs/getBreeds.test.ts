/**
 * Unit tests for GET /breeds
 */

import { handler } from '../../../src/functions/dogs/getBreeds';

describe('getBreeds handler', () => {
  it('returns 200 with a breeds array', async () => {
    const res = await handler();
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(Array.isArray(body.breeds)).toBe(true);
    expect(body.breeds.length).toBeGreaterThan(0);
  });

  it('includes common breeds', () => {
    // Smoke-test that well-known breeds are present — catches accidental list truncation
    const check = async () => {
      const body = JSON.parse(((await handler()) as { body: string }).body);
      return body.breeds as string[];
    };
    return check().then((breeds) => {
      expect(breeds).toContain('Golden Retriever');
      expect(breeds).toContain('Labrador Retriever');
      expect(breeds).toContain('German Shepherd Dog');
      expect(breeds).toContain('Mixed Breed / Mutt');
      expect(breeds).toContain('French Bulldog');
    });
  });

  it('all breeds are non-empty strings', async () => {
    const body = JSON.parse(((await handler()) as { body: string }).body);
    const breeds = body.breeds as unknown[];
    breeds.forEach((b) => {
      expect(typeof b).toBe('string');
      expect((b as string).length).toBeGreaterThan(0);
    });
  });
});
