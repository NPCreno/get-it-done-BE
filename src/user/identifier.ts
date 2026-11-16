/** Login routes on this, not on which endpoint was called (findByEmailOrUsername). */
export const EMAIL_LIKE = /\S+@\S+\.\S+/;

export function isEmailLike(identifier: string): boolean {
  return EMAIL_LIKE.test(identifier);
}
