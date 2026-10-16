/** Cron routes must fail closed when deployment configuration is incomplete. */
export function authorizedCronRequest(authorization: string | null, secret: string | undefined): boolean {
  return typeof secret === "string" && secret.length > 0 && authorization === `Bearer ${secret}`;
}
