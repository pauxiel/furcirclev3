import { handler } from '../../../src/functions/subscriptions/getSubscriptionPlans';

type Result = { statusCode: number; body: string };

describe('getSubscriptionPlans handler', () => {
  it('returns 200 with 4 plans', async () => {
    const result = (await handler({} as never)) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).plans).toHaveLength(4);
  });

  it('plan keys are welcome, protector, proactive, complete_circle', async () => {
    const result = (await handler({} as never)) as Result;
    const { plans } = JSON.parse(result.body);
    expect(plans.map((p: { key: string }) => p.key)).toEqual(['welcome', 'protector', 'proactive', 'complete_circle']);
  });

  it('welcome plan has price 0 and no interval', async () => {
    const result = (await handler({} as never)) as Result;
    const { plans } = JSON.parse(result.body);
    const welcome = plans[0];
    expect(welcome.price).toBe(0);
    expect(welcome.interval).toBeNull();
    expect(welcome.stripePriceId).toBeNull();
  });

  it('protector plan is sellable and carries the Most Popular badge', async () => {
    const result = (await handler({} as never)) as Result;
    const { plans } = JSON.parse(result.body);
    const protector = plans[1];
    expect(protector.comingSoon).toBe(false);
    expect(protector.badge).toBe('Most Popular');
    expect(protector.price).toBe(1499);
  });

  it('proactive plan is hidden as Coming Soon', async () => {
    const result = (await handler({} as never)) as Result;
    const { plans } = JSON.parse(result.body);
    const proactive = plans[2];
    expect(proactive.comingSoon).toBe(true);
    expect(proactive.badge).toBe('Coming Soon');
    expect(proactive.price).toBeNull();
    expect(proactive.credits).toBeNull();
    expect(proactive.stripePriceId).toBeNull();
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
