const MYSQL_DUPLICATE_ENTRY_ERRNO = 1062;

function getErrorStringField(error: Record<string, unknown>, key: string): string | null {
  const value = error[key];
  return typeof value === 'string' ? value : null;
}

function getErrorNumberField(error: Record<string, unknown>, key: string): number | null {
  const value = error[key];
  return typeof value === 'number' ? value : null;
}

export function isMysqlDuplicateEntryError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || typeof current !== 'object' || seen.has(current)) {
      continue;
    }

    seen.add(current);

    const record = current as Record<string, unknown>;
    const code = getErrorStringField(record, 'code');
    const message = getErrorStringField(record, 'message');
    const sqlMessage = getErrorStringField(record, 'sqlMessage');
    const errno = getErrorNumberField(record, 'errno');

    if (
      code === 'ER_DUP_ENTRY' ||
      errno === MYSQL_DUPLICATE_ENTRY_ERRNO ||
      message?.includes('Duplicate entry') ||
      sqlMessage?.includes('Duplicate entry')
    ) {
      return true;
    }

    for (const key of ['cause', 'error', 'originalError']) {
      if (key in record) {
        queue.push(record[key]);
      }
    }
  }

  return false;
}
