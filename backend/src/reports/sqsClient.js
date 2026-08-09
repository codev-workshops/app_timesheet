const { SQSClient } = require('@aws-sdk/client-sqs');

const client = new SQSClient({});

// Some SQS emulators answer errors with two `Date` headers. Node joins them
// into one unparsable value, so ignore non-finite clock-skew corrections.
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
