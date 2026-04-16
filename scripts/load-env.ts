/**
 * Pulls CloudFormation stack outputs into .env.test for local integration testing.
 * Usage: npx ts-node scripts/load-env.ts --stage dev
 */
import { CloudFormationClient, DescribeStacksCommand, type Output } from '@aws-sdk/client-cloudformation';
import { writeFileSync } from 'fs';

const stage = process.argv.includes('--stage')
  ? process.argv[process.argv.indexOf('--stage') + 1]
  : 'dev';

const stackName = `furbeta-${stage}`;
console.log(`Fetching outputs from CloudFormation stack: ${stackName}`);

const cf = new CloudFormationClient({ region: 'us-east-1' });

async function main(): Promise<void> {
  const { Stacks } = await cf.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs: Output[] = Stacks?.[0]?.Outputs ?? [];

  const get = (key: string): string =>
    outputs.find((o) => o.OutputKey === key)?.OutputValue ?? '';

  const env = [
    `USER_POOL_ID=${get('UserPoolId')}`,
    `USER_POOL_CLIENT_ID=${get('UserPoolClientId')}`,
    `TABLE_NAME=${get('TableName')}`,
    `BUCKET_NAME=${get('BucketName')}`,
    `SNS_TOPIC_ARN=${get('SnsTopicArn')}`,
    `API_URL=${get('HttpApiUrl')}`,
    `AWS_REGION=us-east-1`,
    `STAGE=${stage}`,
  ].join('\n');

  writeFileSync('.env.test', env);
  console.log('Written to .env.test');
  console.log(env);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
