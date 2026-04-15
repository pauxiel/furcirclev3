/**
 * Loads deployed stack outputs into process.env for integration/e2e tests.
 * Run `npm run env:load` before running integration tests locally,
 * or set these env vars in CI from the deploy step outputs.
 *
 * Required env vars:
 *   USER_POOL_ID          — Cognito User Pool ID
 *   USER_POOL_CLIENT_ID   — Cognito App Client ID
 *   TABLE_NAME            — DynamoDB table name
 *   API_URL               — HTTP API base URL (for e2e tests)
 *   AWS_REGION            — AWS region (default: us-east-1)
 */
export const requireIntegrationEnv = (): void => {
  const required = ['USER_POOL_ID', 'USER_POOL_CLIENT_ID', 'TABLE_NAME', 'API_URL'];
  const missing = required.filter((k) => !process.env[k]);

  if (missing.length > 0) {
    throw new Error(
      `Integration test env vars missing: ${missing.join(', ')}\n` +
      'Run: npm run env:load  (or set manually from Serverless stack outputs)',
    );
  }
};
