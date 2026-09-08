const normalizeSql = (sql) => sql.replace(/\s+/g, ' ').trim();

// Asserts the nth call of a db mock used exact SQL (whitespace-insensitive) and exact params.
const expectDbCall = (mockFn, callIndex, expectedSql, expectedParams) => {
  const call = mockFn.mock.calls[callIndex];
  expect(call).toBeDefined();
  expect(normalizeSql(call[0])).toBe(normalizeSql(expectedSql));
  expect(call[1]).toEqual(expectedParams);
  expect(typeof call[2]).toBe('function');
};

const silenceConsoleError = () => jest.spyOn(console, 'error').mockImplementation(() => {});

module.exports = { normalizeSql, expectDbCall, silenceConsoleError };
