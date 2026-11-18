/** Login routes on this, not on which endpoint was called (findByEmailOrUsername). */
export const EMAIL_LIKE = /\S+@\S+\.\S+/;

export function isEmailLike(identifier: string): boolean {
  return EMAIL_LIKE.test(identifier);
}

/**
 * BUG-01: the one email normalization. Signup stores it, the login lookup
 * compares `lower("email")` with it, and the login rate-limit key hashes it, so
 * every spelling of one email is one account and one bucket. Usernames are
 * never normalized (they stay exact and case-sensitive).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** DTO `@Transform` for an email field: trims a string, leaves anything else for the validators. */
export const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
