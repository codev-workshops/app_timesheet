const { runWorker } = require('./worker');

runWorker({ maxMessages: 10, waitTimeSeconds: 20 }).catch((error) => {
  console.error('Report worker failed:', error);
  process.exitCode = 1;
});
