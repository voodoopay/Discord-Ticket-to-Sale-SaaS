function safeJsonParse(text: string): unknown {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function performDashboardFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (error) {
    if (error instanceof Error && /failed to fetch/i.test(error.message)) {
      await new Promise((resolve) => setTimeout(resolve, 150));

      try {
        return await fetch(path, init);
      } catch {
        throw new Error('Dashboard request failed. Refresh the page and try again.');
      }
    }

    throw error;
  }
}

export async function dashboardApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await performDashboardFetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? safeJsonParse(responseText) : null;

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : responseText || `Request failed with ${response.status}`;

    throw new Error(message);
  }

  if (isJson) {
    return payload as T;
  }

  return { status: response.status, body: responseText } as T;
}
