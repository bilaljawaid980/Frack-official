export const ADMIN_ROUTE_PREFIXES = [
  "/admin",
  "/activity-logs",
  "/compliance",
  "/issuance",
  "/personnel",
  "/token-admin",
];

export const TRUSTED_PROVIDER_ROUTE_PREFIXES = [
  "/identity",
  "/issuer/identity",
  "/kyc-provider",
  "/trusted-provider",
];

export function routeMatches(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
