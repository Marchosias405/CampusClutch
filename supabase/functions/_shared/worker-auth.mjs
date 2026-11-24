import { timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();

// These calls originate in pg_cron. Browser clients never need a worker secret.
export function hasWorkerSecret(request, headerName, expected) {
  const supplied = request.headers.get(headerName);
  if (!expected || !supplied || request.headers.has('origin')) return false;
  const actual = encoder.encode(supplied);
  const secret = encoder.encode(expected);
  return actual.length === secret.length && timingSafeEqual(actual, secret);
}
