const {
  clientSchema,
  workEntrySchema,
  updateWorkEntrySchema,
  updateClientSchema
} = require('../../validation/schemas');

const valid = (schema, input) => {
  const { error, value } = schema.validate(input);
  expect(error).toBeUndefined();
  return value;
};
const invalid = (schema, input) => {
  const { error } = schema.validate(input);
  expect(error).toBeDefined();
};

describe('Validation Schemas - boundary and trimming contracts', () => {
  describe.each([
    ['clientSchema', clientSchema, { name: 'Client' }],
    ['updateClientSchema', updateClientSchema, {}]
  ])('%s', (_, schema, base) => {
    test('name accepts 1..255 chars (trimmed) and rejects 256', () => {
      valid(schema, { ...base, name: 'a' });
      valid(schema, { ...base, name: 'ab' });
      valid(schema, { ...base, name: 'a'.repeat(255) });
      invalid(schema, { ...base, name: 'a'.repeat(256) });
      expect(valid(schema, { ...base, name: '  Padded  ' }).name).toBe('Padded');
    });

    test('description is trimmed, accepts 1000 chars, rejects 1001, allows empty', () => {
      expect(valid(schema, { ...base, description: '  hello  ' }).description).toBe('hello');
      valid(schema, { ...base, description: 'a'.repeat(1000) });
      invalid(schema, { ...base, description: 'a'.repeat(1001) });
      expect(valid(schema, { ...base, description: '' }).description).toBe('');
    });

    test('department is trimmed, accepts 255 chars, rejects 256, allows empty', () => {
      expect(valid(schema, { ...base, department: '  Eng  ' }).department).toBe('Eng');
      valid(schema, { ...base, department: 'a'.repeat(255) });
      valid(schema, { ...base, department: 'a' });
      invalid(schema, { ...base, department: 'a'.repeat(256) });
      expect(valid(schema, { ...base, department: '' }).department).toBe('');
    });

    test('email is trimmed, must be a valid address, max 255, allows empty', () => {
      expect(valid(schema, { ...base, email: '  a@b.com  ' }).email).toBe('a@b.com');
      valid(schema, { ...base, email: 'a@b.com' });
      invalid(schema, { ...base, email: 'not-an-email' });
      invalid(schema, { ...base, email: `${'a'.repeat(250)}@example.com` });
      expect(valid(schema, { ...base, email: '' }).email).toBe('');
    });
  });

  describe.each([
    ['workEntrySchema', workEntrySchema, { clientId: 1, hours: 1, date: '2024-01-01' }],
    ['updateWorkEntrySchema', updateWorkEntrySchema, {}]
  ])('%s', (_, schema, base) => {
    test('description is trimmed, accepts 1000 chars, rejects 1001, allows empty', () => {
      expect(valid(schema, { ...base, description: '  work  ' }).description).toBe('work');
      valid(schema, { ...base, description: 'a'.repeat(1000) });
      invalid(schema, { ...base, description: 'a'.repeat(1001) });
      expect(valid(schema, { ...base, description: '' }).description).toBe('');
    });

    test('hours must be positive, at most 24, integer clientId must be positive', () => {
      valid(schema, { ...base, hours: 24 });
      invalid(schema, { ...base, hours: 24.01 });
      invalid(schema, { ...base, hours: 0 });
      invalid(schema, { ...base, clientId: 1.5 });
      invalid(schema, { ...base, clientId: 0 });
    });
  });
});
