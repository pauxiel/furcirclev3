import Stripe from 'stripe';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

let client: InstanceType<typeof Stripe> | null = null;

export const getStripe = async (): Promise<InstanceType<typeof Stripe>> => {
  if (client) return client;

  const stage = process.env['STAGE'] ?? 'dev';
  const { Parameter } = await ssm.send(
    new GetParameterCommand({
      Name: `/furcircle/${stage}/stripe/secretKey`,
      WithDecryption: true,
    }),
  );

  client = new Stripe(Parameter!.Value!, { apiVersion: '2026-03-25.dahlia' });
  return client;
};
