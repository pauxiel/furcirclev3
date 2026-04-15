/**
 * Pulls Serverless stack outputs into .env.test for local integration testing.
 * Usage: npx ts-node scripts/load-env.ts --stage dev
 */
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const stage = process.argv.includes('--stage')
  ? process.argv[process.argv.indexOf('--stage') + 1]
  : 'dev';

console.log(`Loading stack outputs for stage: ${stage}`);

const output = execSync(`npx serverless info --stage ${stage} --verbose`, { encoding: 'utf8' });

const parse = (key: string): string => {
  const match = output.match(new RegExp(`${key}:\\s*(.+)`));
  return match?.[1]?.trim() ?? '';
};

// Parse API endpoint URL from sls info output
const apiUrl = output.match(/https:\/\/\S+\.execute-api\.\S+\.amazonaws\.com/)?.[0] ?? '';

const env = [
  `USER_POOL_ID=${parse('UserPoolId')}`,
  `USER_POOL_CLIENT_ID=${parse('UserPoolClientId')}`,
  `TABLE_NAME=${parse('TableName')}`,
  `BUCKET_NAME=${parse('BucketName')}`,
  `SNS_TOPIC_ARN=${parse('SnsTopicArn')}`,
  `API_URL=${apiUrl}`,
  `AWS_REGION=us-east-1`,
  `STAGE=${stage}`,
].join('\n');

writeFileSync('.env.test', env);
console.log('Written to .env.test');
console.log(env);
