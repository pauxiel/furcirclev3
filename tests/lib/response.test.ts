import { success, error } from '../../src/lib/response';

describe('response.success', () => {
  it('returns 200 with JSON body by default', () => {
    const result = success({ userId: 'abc' });
    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(result.body)).toEqual({ userId: 'abc' });
  });

  it('accepts custom status code', () => {
    const result = success({ dogId: 'xyz' }, 201);
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual({ dogId: 'xyz' });
  });

  it('handles null data', () => {
    const result = success(null);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toBeNull();
  });
});

describe('response.error', () => {
  it('returns 400 with error code and message', () => {
    const result = error('VALIDATION_ERROR', 'name is required', 400);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('name is required');
  });

  it('returns 500 by default', () => {
    const result = error('INTERNAL_ERROR', 'something went wrong');
    expect(result.statusCode).toBe(500);
  });

  it('returns 404', () => {
    const result = error('DOG_NOT_FOUND', 'No dog found with id abc', 404);
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('DOG_NOT_FOUND');
  });
});
