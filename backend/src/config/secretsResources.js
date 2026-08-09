const { secretName } = require('./secrets');

async function ensureJwtSecret(value) {
  if (value === undefined) return undefined;

  const {
    CreateSecretCommand,
    PutSecretValueCommand
  } = require('@aws-sdk/client-secrets-manager');
  const { client } = require('./secretsClient');

  try {
    return await client.send(new CreateSecretCommand({
      Name: secretName(),
      SecretString: value
    }));
  } catch (error) {
    if (error.name !== 'ResourceExistsException') throw error;
    return client.send(new PutSecretValueCommand({
      SecretId: secretName(),
      SecretString: value
    }));
  }
}

module.exports = { ensureJwtSecret };
