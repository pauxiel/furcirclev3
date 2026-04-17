import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import { getStripe } from '../../lib/stripe';

const CREDIT_PACKAGES: Record<number, number> = { 10: 1000, 20: 1800, 50: 4000 };

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { credits, paymentMethodId } = body;

  if (typeof credits !== 'number' || !(credits in CREDIT_PACKAGES)) {
    return error('INVALID_CREDIT_PACKAGE', 'credits must be 10, 20, or 50', 400);
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

  const amount = CREDIT_PACKAGES[credits as number];
  const stripe = await getStripe();

  await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: subscription['stripeCustomerId'] as string,
    payment_method: paymentMethodId,
    confirm: true,
    off_session: true,
  });

  const updateResult = await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' },
      UpdateExpression: 'ADD creditBalance :credits SET updatedAt = :now',
      ExpressionAttributeValues: {
        ':credits': credits,
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'UPDATED_NEW',
    }),
  );

  const newBalance = (updateResult.Attributes?.['creditBalance'] as number) ?? 0;

  return success({ creditBalance: newBalance, creditsAdded: credits });
};
