const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

// The client is built with an empty config on purpose: region and (optional)
// endpoint come from AWS_REGION / AWS_ENDPOINT_URL, so nothing about the
// deployment — or the test emulator — is baked into the application.
const client = new DynamoDBClient({});

// Some DynamoDB emulators answer errors with two `Date` headers. Node joins
// them into one unparsable value, the SDK's clock-skew correction then stores
// NaN as the system clock offset, and every later request fails to sign with
// "Invalid time value". Ignore non-finite offsets.
let systemClockOffset = 0;
Object.defineProperty(client.config, 'systemClockOffset', {
  configurable: true,
  enumerable: true,
  get: () => systemClockOffset,
  set: (value) => {
    if (Number.isFinite(value)) systemClockOffset = value;
  }
});

module.exports = { client };
