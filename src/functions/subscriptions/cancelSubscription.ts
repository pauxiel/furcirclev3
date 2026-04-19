import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import { getStripe } from '../../lib/stripe';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const subResult = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' } }),
  );
  const subscription = subResult.Item;

  if (!subscription) return error('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
  if (!subscription['stripeSubscriptionId']) {
    return error('NO_ACTIVE_SUBSCRIPTION', 'No active paid subscription to cancel', 400);
  }

  const stripeSubscriptionId = subscription['stripeSubscriptionId'] as string;
  const currentPeriodEnd = subscription['currentPeriodEnd'] as string;

  const stripe = await getStripe();
  await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' },
      UpdateExpression: 'SET #status = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'cancelling',
        ':now': new Date().toISOString(),
      },
    }),
  );

  return success({ status: 'cancelling', cancelsAt: currentPeriodEnd });
};
