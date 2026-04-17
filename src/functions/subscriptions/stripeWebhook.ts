import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { docClient } from '../../lib/dynamodb';
import { getStripe } from '../../lib/stripe';
import { success, error } from '../../lib/response';

const ssm = new SSMClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
let cachedWebhookSecret: string | null = null;

const getWebhookSecret = async (): Promise<string> => {
  if (cachedWebhookSecret) return cachedWebhookSecret;
  const stage = process.env['STAGE'] ?? 'dev';
  const { Parameter } = await ssm.send(
    new GetParameterCommand({
      Name: `/furcircle/${stage}/stripe/webhookSecret`,
      WithDecryption: true,
    }),
  );
  cachedWebhookSecret = Parameter!.Value!;
  return cachedWebhookSecret;
};

const findOwnerByEmail = async (table: string, email: string): Promise<string | null> => {
  const result = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: { ':pk': `EMAIL#${email}`, ':sk': 'OWNER' },
      Limit: 1,
    }),
  );
  const item = result.Items?.[0];
  if (!item) return null;
  return (item['PK'] as string).replace('OWNER#', '');
};

const findOwnerByCustomerIdViaStripe = async (
  stripe: Awaited<ReturnType<typeof getStripe>>,
  table: string,
  customerId: string,
): Promise<string | null> => {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return null;
  const email = (customer as { email?: string | null }).email;
  if (!email) return null;
  return findOwnerByEmail(table, email);
};

const updateSubscription = async (
  table: string,
  ownerId: string,
  updates: Record<string, unknown>,
): Promise<void> => {
  const now = new Date().toISOString();
  const keys = Object.keys(updates);
  const setExpr = keys.map((k) => `#${k} = :${k}`).join(', ') + ', updatedAt = :now';
  const attrNames: Record<string, string> = {};
  const attrValues: Record<string, unknown> = { ':now': now };
  for (const k of keys) {
    attrNames[`#${k}`] = k;
    attrValues[`:${k}`] = updates[k];
  }
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `OWNER#${ownerId}`, SK: 'SUBSCRIPTION' },
      UpdateExpression: `SET ${setExpr}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
    }),
  );
};

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const sig = event.headers['stripe-signature'] ?? '';
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');

  const stripe = await getStripe();
  const webhookSecret = await getWebhookSecret();

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch {
    return error('INVALID_SIGNATURE', 'Invalid Stripe signature', 400);
  }

  const table = process.env['TABLE_NAME']!;

  try {
    switch (stripeEvent.type) {
      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object as { customer: string };
        const customer = await stripe.customers.retrieve(invoice.customer);
        if (customer.deleted) break;
        const email = (customer as { email?: string | null }).email;
        if (!email) break;
        const ownerId = await findOwnerByEmail(table, email);
        if (!ownerId) break;
        const result = await docClient.send(
          new QueryCommand({
            TableName: table,
            KeyConditionExpression: 'PK = :pk AND SK = :sk',
            ExpressionAttributeValues: { ':pk': `OWNER#${ownerId}`, ':sk': 'SUBSCRIPTION' },
          }),
        );
        const sub = result.Items?.[0];
        if (sub?.['plan'] === 'proactive') {
          await updateSubscription(table, ownerId, { creditBalance: 70 });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object as { customer: string };
        const customer = await stripe.customers.retrieve(invoice.customer);
        if (customer.deleted) break;
        const email = (customer as { email?: string | null }).email;
        if (!email) break;
        const ownerId = await findOwnerByEmail(table, email);
        if (!ownerId) break;
        await updateSubscription(table, ownerId, { status: 'past_due' });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object as {
          customer: string;
          status: string;
          items: { data: Array<{ current_period_end: number; price: { id: string } }> };
        };
        const ownerId = await findOwnerByCustomerIdViaStripe(stripe, table, sub.customer);
        if (!ownerId) break;
        const item = sub.items.data[0];
        const currentPeriodEnd = new Date(item.current_period_end * 1000).toISOString();
        await updateSubscription(table, ownerId, {
          status: sub.status,
          currentPeriodEnd,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object as { customer: string };
        const ownerId = await findOwnerByCustomerIdViaStripe(stripe, table, sub.customer);
        if (!ownerId) break;
        await updateSubscription(table, ownerId, {
          plan: 'welcome',
          creditBalance: 0,
          status: 'active',
          stripeSubscriptionId: null,
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }

  return success({});
};
