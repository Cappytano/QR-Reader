let truncateFields;

beforeAll(async () => {
  ({ truncateFields } = await import('../xlsx-truncate.js'));
});

test('truncateFields trims long strings and appends ellipsis', () => {
  const rows = [{ field: 'a'.repeat(32761) }];
  truncateFields(rows);
  expect(rows[0].field.length).toBe(32760);
  expect(rows[0].field.endsWith('…')).toBe(true);
});

test('truncateFields leaves short strings unchanged', () => {
  const rows = [{ field: 'short' }];
  truncateFields(rows);
  expect(rows[0].field).toBe('short');
});

test('truncateFields ignores non-string values', () => {
  const rows = [{ num: 123, nil: null }];
  truncateFields(rows);
  expect(rows[0].num).toBe(123);
  expect(rows[0].nil).toBe(null);
});
