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
    badge: null,
    tagline: null,
    comingSoon: false,
  },
  {
    key: 'protector',
    name: 'The Protector',
    price: 1499,
    currency: 'usd',
    interval: 'month',
    credits: 0,
    features: [
      'Everything in The Welcome Plan',
      'Unlimited Ask a Vet with priority response',
      'Free behaviour assessment',
      'Curated training video library with breed-specific recommendations updated every month',
      'Daily wellness nudges so you never miss a critical window',
    ],
    stripePriceId: process.env['STRIPE_PRICE_ID_PROTECTOR'] ?? null,
    badge: null,
    tagline: 'For the owner who wants to do this right.',
    comingSoon: false,
  },
  {
    key: 'proactive',
    name: 'The Proactive Parent',
    price: 3999,
    currency: 'usd',
    interval: 'month',
    credits: 70,
    features: [
      'Everything in The Protector',
      '70 credits/month for any video consultation with a vet, behaviourist or nutritionist',
      'Monthly AI wellness report summarising progress and flagging concerns',
      'Priority booking — always first in line',
      'Early access to new features',
      'Partner discounts on premium food, supplements and preventive care',
    ],
    stripePriceId: process.env['STRIPE_PRICE_ID_PROACTIVE'] ?? null,
    badge: 'Most Popular',
    tagline: 'For the owner who refuses to wait until something goes wrong.',
    comingSoon: false,
  },
  {
    key: 'complete_circle',
    name: 'The Complete Circle',
    price: null,
    currency: 'usd',
    interval: 'month',
    credits: null,
    features: [
      'Everything in The Proactive Parent',
      'Monthly credit allowance unlocking every service',
      'Walking, daycare, grooming and training',
      'One plan. One credit balance. Everything covered.',
    ],
    stripePriceId: null,
    badge: 'Coming Soon',
    tagline: null,
    comingSoon: true,
  },
];

export const handler = async (_event: unknown): Promise<APIGatewayProxyResultV2> => {
  return success({ plans: PLANS });
};
