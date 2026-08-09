/*
 * JWT_SECRET resolution supports:
 * - SECRETS_BACKEND=env (the default): process.env.JWT_SECRET
 * - SECRETS_BACKEND=aws: Secrets Manager secret
 *
 * AWS secret names are `${SECRETS_NAME_PREFIX || ''}${JWT_SECRET_NAME ||
 * 'timesheet/jwt-secret'}`. SecretString may be a plain string or a JSON
 * object; JSON uses the `JWT_SECRET_JSON_KEY` property (default `JWT_SECRET`).
 * An unset environment value and ResourceNotFoundException both resolve to
 * undefined rather than throwing. Successful values are cached until
 * resetJwtSecretCache() is called.
 *
 * EMULATED VS NATIVE DIFFERENCES:
 * 1. E2E uses moto rather than the managed Secrets Manager service.
 * 2. The tests do not exercise KMS encryption/decryption or customer-managed
 * key permissions.
 * 3. The tests do not exercise rotation schedules, rotation Lambda execution,
 * staging labels, or version lifecycle semantics.
 * 4. The tests do not exercise deletion recovery windows or restore behavior.
 * 5. The tests do not exercise IAM policy evaluation, CloudTrail audit events,
 * cross-account access, replication, quotas, throttling, or managed-service
 * availability/latency behavior.
 */

let cachedSecret;
let hasCachedSecret = false;

function secretName() {
  const prefix = process.env.SECRETS_NAME_PREFIX || '';
  const name = process.env.JWT_SECRET_NAME || 'timesheet/jwt-secret';
  return `${prefix}${name}`;
}

function jsonKey() {
  return process.env.JWT_SECRET_JSON_KEY || 'JWT_SECRET';
}

function parseSecret(secretString) {
  if (typeof secretString !== 'string') return undefined;
  const trimmed = secretString.trim();
  if (!trimmed.startsWith('{')) return secretString;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed[jsonKey()];
  } catch (error) {
    return secretString;
  }
}

async function getAwsJwtSecret() {
  // Keep the AWS SDK and client out of the default env-backed code path.
  const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const { client } = require('./secretsClient');

  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretName() }));
    return parseSecret(response.SecretString);
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') return undefined;
    throw error;
  }
}

async function getJwtSecret() {
  if (hasCachedSecret) return cachedSecret;

  const value = (process.env.SECRETS_BACKEND || 'env').toLowerCase() === 'aws'
    ? await getAwsJwtSecret()
    : process.env.JWT_SECRET;
  if (value !== undefined) {
    cachedSecret = value;
    hasCachedSecret = true;
  }
  return value;
}

function resetJwtSecretCache() {
  cachedSecret = undefined;
  hasCachedSecret = false;
}

module.exports = { getJwtSecret, resetJwtSecretCache, secretName };
