import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import { getStripe } from '../../lib/stripe';

const VALID_PLAN_KEYS = ['protector', 'proactive'] as const;
type PaidPlanKey = (typeof VALID_PLAN_KEYS)[number];

const PLAN_PRICE_IDS: Record<PaidPlanKey, string> = {
  protector: process.env['STRIPE_PRICE_ID_PROTECTOR'] ?? '',
  proactive: process.env['STRIPE_PRICE_ID_PROACTIVE'] ?? '',
};

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { planKey, paymentMethodId } = body;

  if (!planKey || !VALID_PLAN_KEYS.includes(planKey as PaidPlanKey)) {
    return error('VALIDATION_ERROR', 'planKey must be protector or proactive', 400);
  }
  if (!paymentMethodId || typeof paymentMethodId !== 'string') {
    return error('VALIDATION_ERROR', 'paymentMethodId required', 400);
  }

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const subResult = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' } }),
  );
  const subscription = subResult.Item;

  if (!subscription) return error('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
  if (!subscription['stripeCustomerId']) {
    return error('STRIPE_CUSTOMER_REQUIRED', 'Create a Stripe customer first', 400);
  }

  const stripeCustomerId = subscription['stripeCustomerId'] as string;
  const stripe = await getStripe();

  await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId });
  await stripe.customers.update(stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const stripeSub = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: PLAN_PRICE_IDS[planKey as PaidPlanKey] }],
  });

  const creditBalance = planKey === 'proactive' ? 70 : 0;
  const firstItem = stripeSub.items.data[0];
  const currentPeriodEnd = new Date(firstItem.current_period_end * 1000).toISOString();
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' },
      UpdateExpression:
        'SET #plan = :plan, stripeSubscriptionId = :subId, #status = :status, currentPeriodEnd = :end, creditBalance = :credits, updatedAt = :now',
      ExpressionAttributeNames: { '#plan': 'plan', '#status': 'status' },
      ExpressionAttributeValues: {
        ':plan': planKey,
        ':subId': stripeSub.id,
        ':status': 'active',
        ':end': currentPeriodEnd,
        ':credits': creditBalance,
        ':now': now,
      },
    }),
  );

  return success({ plan: planKey, creditBalance, status: 'active', currentPeriodEnd });
};
