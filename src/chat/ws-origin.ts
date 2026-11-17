/**
 * The chat socket accepts only the frontend's origin (FRONTEND_URL, default
 * http://localhost:3000, the same as CORS). A missing or unparsable Origin is
 * refused.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  frontendUrl: string = process.env.FRONTEND_URL || 'http://localhost:3000',
): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(frontendUrl).origin;
  } catch {
    return false;
  }
}
