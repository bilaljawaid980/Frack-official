'use client';

import { useIdentityContext } from '@/contexts/identity-context';
export type { IdentityClaim, UserIdentity } from '@/contexts/identity-context';

export function useIdentity() {
  return useIdentityContext();
}
