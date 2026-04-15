/**
 * Integration tests for GET /owners/me and PUT /owners/me.
 * Requires deployed dev stack + .env.test loaded.
 * Run: npm run test:integration
 */
import axios from 'axios';
import { config } from 'dotenv';
import { given_an_authenticated_user, teardown_user, TestUser } from '../fixtures/users';
import { requireIntegrationEnv } from '../fixtures/env';

config({ path: '.env.test' });

describe('Owners API (integration)', () => {
  let user: TestUser | null = null;

  beforeAll(async () => {
    requireIntegrationEnv();
    user = await given_an_authenticated_user();
  });

  afterAll(async () => {
    await teardown_user(user);
  });

  it('GET /owners/me returns owner profile', async () => {
    const res = await axios.get(`${process.env['API_URL']}/owners/me`, {
      headers: { Authorization: `Bearer ${user!.idToken}` },
    });

    expect(res.status).toBe(200);
    expect(res.data.userId).toBeDefined();
    expect(res.data.email).toBe(user!.email);
    expect(res.data.subscription).toBeDefined();
    expect(res.data.subscription.plan).toBe('welcome');
  });

  it('GET /owners/me returns 401 with no token', async () => {
    await expect(
      axios.get(`${process.env['API_URL']}/owners/me`),
    ).rejects.toMatchObject({ response: { status: 401 } });
  });

  it('PUT /owners/me updates pushToken', async () => {
    const res = await axios.put(
      `${process.env['API_URL']}/owners/me`,
      { pushToken: 'ExponentPushToken[test123]' },
      { headers: { Authorization: `Bearer ${user!.idToken}` } },
    );

    expect(res.status).toBe(200);
    expect(res.data.pushToken).toBe('ExponentPushToken[test123]');
  });
});
