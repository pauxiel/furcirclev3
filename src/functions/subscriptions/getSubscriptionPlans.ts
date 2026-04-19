import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { success } from '../../lib/response';

const PLANS = [
  {
    key: 'welcome',
    name: 'The Welcome Plan',
    price: 0,
    currency: 'usd',
    interval: null,
    credits: 0,
    features: [
      'AI-powered personalised monthly wellness roadmap',
      'Ask a Vet once a month',
      'Basic milestone tracking',
    ],
    stripePriceId: null,
  },
  {
    key: 'protector',
    name: 'The Protector',
    price: 1900,
    currency: 'usd',
    interval: 'month',
    credits: 0,
    features: [
      'Everything in The Welcome Plan',
      'Unlimited Ask a Vet with priority response',
      'Free behaviour assessment',
      'Curated training video library',
      'Daily wellness nudges',
    ],
    stripePriceId: process.env['STRIPE_PRICE_ID_PROTECTOR'] ?? null,
    badge: null,
  },
  {
    key: 'proactive',
    name: 'The Proactive Parent',
    price: 3800,
    currency: 'usd',
    interval: 'month',
    credits: 70,
    features: [
      'Everything in The Protector',
      '70 credits/month for video consultations',
      'Monthly AI wellness report',
      'Priority booking',
      'Early access to new features',
      'Partner discounts on premium food & care',
    ],
    stripePriceId: process.env['STRIPE_PRICE_ID_PROACTIVE'] ?? null,
    badge: 'Most Popular',
  },
];

export const handler = async (_event: unknown): Promise<APIGatewayProxyResultV2> => {
  return success({ plans: PLANS });
};
