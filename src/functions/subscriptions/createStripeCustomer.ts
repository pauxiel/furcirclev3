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

  const [profileResult, subResult] = await Promise.all([
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'PROFILE' } })),
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' } })),
  ]);

  const profile = profileResult.Item;
  const subscription = subResult.Item;

  if (!profile) return error('OWNER_NOT_FOUND', 'Owner not found', 404);
  if (!subscription) return error('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);

  if (subscription['stripeCustomerId']) {
    return success({ stripeCustomerId: subscription['stripeCustomerId'] as string });
  }

  const stripe = await getStripe();
  const customer = await stripe.customers.create({
    email: profile['email'] as string,
    name: `${profile['firstName'] as string} ${profile['lastName'] as string}`,
    metadata: { userId },
  });

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' },
      UpdateExpression: 'SET stripeCustomerId = :id, updatedAt = :now',
      ExpressionAttributeValues: {
        ':id': customer.id,
        ':now': new Date().toISOString(),
      },
    }),
  );

  return success({ stripeCustomerId: customer.id });
};
