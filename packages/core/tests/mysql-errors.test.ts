import { describe, expect, it } from 'vitest';

import { isMysqlDuplicateEntryError } from '../src/utils/mysql-errors.js';

describe('isMysqlDuplicateEntryError', () => {
  it('returns true for direct duplicate entry errors', () => {
    expect(
      isMysqlDuplicateEntryError({
        code: 'ER_DUP_ENTRY',
        message: "Duplicate entry 'order-1' for key 'orders_paid.order_session_id'",
      }),
    ).toBe(true);
  });

  it('returns true when the duplicate error is nested inside a wrapper', () => {
    expect(
      isMysqlDuplicateEntryError({
        message: 'Failed query',
        cause: {
          errno: 1062,
          sqlMessage: "Duplicate entry 'email@example.com' for key 'customer_first_paid_orders.email'",
        },
      }),
    ).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(
      isMysqlDuplicateEntryError({
        code: 'ER_BAD_FIELD_ERROR',
        message: "Unknown column 'missing_column'",
      }),
    ).toBe(false);
  });
});
