const { CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');

const { client } = require('./dynamoClient');

function prefix() {
  return process.env.DYNAMODB_TABLE_PREFIX || '';
}

function tableNames() {
  return {
    users: `${prefix()}users`,
    clients: `${prefix()}clients`,
    work_entries: `${prefix()}work_entries`
  };
}

function definitions() {
  const names = tableNames();
  return [
    {
      TableName: names.users,
      AttributeDefinitions: [{ AttributeName: 'email', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST'
    },
    {
      TableName: names.clients,
      AttributeDefinitions: [
        { AttributeName: 'user_email', AttributeType: 'S' },
        { AttributeName: 'id', AttributeType: 'N' }
      ],
      KeySchema: [
        { AttributeName: 'user_email', KeyType: 'HASH' },
        { AttributeName: 'id', KeyType: 'RANGE' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'id-index',
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' }
        }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    },
    {
      TableName: names.work_entries,
      AttributeDefinitions: [
        { AttributeName: 'user_email', AttributeType: 'S' },
        { AttributeName: 'id', AttributeType: 'N' },
        { AttributeName: 'client_id', AttributeType: 'N' },
        // `date` is bound the way node-sqlite3 binds a JS Date: epoch
        // milliseconds. The sort key therefore has to be numeric.
        { AttributeName: 'date', AttributeType: 'N' }
      ],
      KeySchema: [
        { AttributeName: 'user_email', KeyType: 'HASH' },
        { AttributeName: 'id', KeyType: 'RANGE' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'client-index',
          KeySchema: [
            { AttributeName: 'client_id', KeyType: 'HASH' },
            { AttributeName: 'date', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' }
        },
        {
          IndexName: 'id-index',
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' }
        }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    }
  ];
}

async function createTables() {
  for (const definition of definitions()) {
    try {
      await client.send(new CreateTableCommand(definition));
    } catch (error) {
      if (error.name !== 'ResourceInUseException') throw error;
    }
    await client.send(new DescribeTableCommand({ TableName: definition.TableName }));
  }
}

module.exports = { createTables, tableNames, definitions };
