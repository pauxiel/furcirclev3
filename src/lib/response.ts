const headers = { 'Content-Type': 'application/json' };

export const success = (data: unknown, statusCode = 200) => ({
  statusCode,
  headers,
  body: JSON.stringify(data),
});

export const error = (code: string, message: string, statusCode = 500) => ({
  statusCode,
  headers,
  body: JSON.stringify({ error: code, message }),
});
