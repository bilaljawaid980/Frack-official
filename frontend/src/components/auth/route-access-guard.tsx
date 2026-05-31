"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppContext } from "@/contexts/app-context";
import { usePermissionsContext } from "@/contexts/permissions-context";
import {
  ADMIN_ROUTE_PREFIXES,
  TRUSTED_PROVIDER_ROUTE_PREFIXES,
  routeMatches,
} from "@/lib/rbac";

function RestrictedState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[22px] p-8 glass-panel">
      <div className="mx-auto flex min-h-[45vh] max-w-lg flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
        <p className="mt-3 text-sm text-slate-600">{description}</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-[#172E7F] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#21439B]"
        >
          Return to market
        </Link>
      </div>
    </div>
  );
}

export function RouteAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { address } = useAppContext();
  const { isPlatformAdmin, isClaimProvider, loading } = usePermissionsContext();
  const isAdminRoute = routeMatches(pathname, ADMIN_ROUTE_PREFIXES);
  const isTrustedProviderRoute = routeMatches(
    pathname,
    TRUSTED_PROVIDER_ROUTE_PREFIXES,
  );

  if (isAdminRoute && !isPlatformAdmin) {
    return (
      <RestrictedState
        title="Access restricted"
        description="This page is available only to the platform admin wallet."
      />
    );
  }

  if (isTrustedProviderRoute && !isPlatformAdmin && !isClaimProvider) {
    if (address && loading) {
      return (
        <RestrictedState
          title="Checking access"
          description="Verifying your trusted provider role."
        />
      );
    }

    return (
      <RestrictedState
        title="Access restricted"
        description="This page is available only to trusted claim providers and the platform admin."
      />
    );
  }

  return <>{children}</>;
}
