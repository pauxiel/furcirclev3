import { handler } from '../../../src/functions/subscriptions/getSubscriptionPlans';

type Result = { statusCode: number; body: string };

describe('getSubscriptionPlans handler', () => {
  it('returns 200 with 3 plans', async () => {
    const result = (await handler({} as never)) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).plans).toHaveLength(3);
  });

  it('plan keys are welcome, protector, proactive', async () => {
    const result = (await handler({} as never)) as Result;
    const { plans } = JSON.parse(result.body);
    expect(plans.map((p: { key: string }) => p.key)).toEqual(['welcome', 'protector', 'proactive']);
  });

  it('welcome plan has price 0 and no interval', async () => {
    const result = (await handler({} as never)) as Result;
    const { plans } = JSON.parse(result.body);
    const welcome = plans[0];
    expect(welcome.price).toBe(0);
    expect(welcome.interval).toBeNull();
    expect(welcome.stripePriceId).toBeNull();
  });

  it('proactive plan has 70 credits and Most Popular badge', async () => {
    const result = (await handler({} as never)) as Result;
    const { plans } = JSON.parse(result.body);
    const proactive = plans[2];
    expect(proactive.credits).toBe(70);
    expect(proactive.badge).toBe('Most Popular');
    expect(proactive.price).toBe(3800);
  });

  it('each plan has features array', async () => {
    const result = (await handler({} as never)) as Result;
    const { plans } = JSON.parse(result.body);
    plans.forEach((p: { features: unknown[] }) => {
      expect(Array.isArray(p.features)).toBe(true);
      expect(p.features.length).toBeGreaterThan(0);
    });
  });
});
