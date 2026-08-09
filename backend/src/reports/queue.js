const {
  CreateQueueCommand,
  GetQueueUrlCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand
} = require('@aws-sdk/client-sqs');
const { client } = require('./sqsClient');

function queueName() {
  const prefix = process.env.SQS_QUEUE_PREFIX || '';
  return `${prefix}${process.env.SQS_QUEUE_NAME || 'report-jobs'}`;
}

async function initializeReportQueue() {
  const explicitUrl = process.env.SQS_QUEUE_URL;
  if (explicitUrl) return explicitUrl;
  try {
    await client.send(new CreateQueueCommand({ QueueName: queueName() }));
  } catch (error) {
    if (!['QueueNameExists', 'QueueAlreadyExists'].includes(error.name)) throw error;
  }
  const result = await client.send(new GetQueueUrlCommand({ QueueName: queueName() }));
  return result.QueueUrl;
}

async function sendReportJob(message) {
  const QueueUrl = await initializeReportQueue();
  return client.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify(message) }));
}

async function receiveReportJobs(maxMessages = 1, waitTimeSeconds = 0) {
  const QueueUrl = await initializeReportQueue();
  const result = await client.send(new ReceiveMessageCommand({
    QueueUrl, MaxNumberOfMessages: maxMessages, WaitTimeSeconds: waitTimeSeconds,
    ...(process.env.SQS_VISIBILITY_TIMEOUT !== undefined
      ? { VisibilityTimeout: Number(process.env.SQS_VISIBILITY_TIMEOUT) } : {})
  }));
  return (result.Messages || []).map((message) => ({ ...message, QueueUrl }));
}

async function deleteReportJob(message) {
  return client.send(new DeleteMessageCommand({
    QueueUrl: message.QueueUrl || await initializeReportQueue(),
    ReceiptHandle: message.ReceiptHandle
  }));
}

module.exports = {
  initializeReportQueue,
  sendReportJob,
  receiveReportJobs,
  deleteReportJob
};
