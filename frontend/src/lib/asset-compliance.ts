import type { RWAAsset } from "@/types/rwa";
import {
  COMPLIANCE_MODULES,
  MOD_COUNTRY_RESTRICT,
  MOD_DAILY_LIMIT,
  MOD_LOCKUP,
  MOD_MAX_BALANCE,
  MOD_MAX_INVESTORS,
  MOD_MAX_TRANSFER,
  MOD_SUPPLY_CAP,
  MOD_COUNTRY_CAP,
} from "@/lib/constants";

type MetadataRecord = Record<string, unknown>;

export type TrustedIssuerMetadata = {
  label?: string;
  walletAddress?: string;
  issuerFid?: string;
  topics?: Array<string | number>;
};

export type ComplianceRuleRow = {
  id: string;
  label: string;
  description: string;
  value: string;
};

const MODULE_LABELS = new Map(
  COMPLIANCE_MODULES.map((module) => [module.programId.toBase58(), module]),
);

function asRecord(value: unknown): MetadataRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as MetadataRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseNumberList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => parseNumberList(entry))
      .filter((entry, index, list) => list.indexOf(entry) === index);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return [Math.trunc(value)];
  }

  if (typeof value !== "string") return [];

  return value
    .split(/[,\s]+/)
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Math.trunc(entry));
}

function parseCountryCaps(value: unknown): Array<{ country: number; cap: string }> {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const record = asRecord(entry);
        const country = Number(record.country);
        if (!Number.isFinite(country)) return null;
        return { country: Math.trunc(country), cap: String(record.cap ?? "") };
      })
      .filter(Boolean) as Array<{ country: number; cap: string }>;
  }

  if (typeof value !== "string") return [];

  return value
    .split(/[,\s]+/)
    .map((entry) => {
      const [country, cap] = entry.split(":").map((part) => part.trim());
      const parsedCountry = Number(country);
      if (!Number.isFinite(parsedCountry)) return null;
      return { country: Math.trunc(parsedCountry), cap: cap || "" };
    })
    .filter(Boolean) as Array<{ country: number; cap: string }>;
}

function topicStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((topic) => String(topic));
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  if (typeof value === "number") return [String(value)];
  return [];
}

export function getTrustedIssuers(asset: RWAAsset): TrustedIssuerMetadata[] {
  const issuers = asset.metadata?.trustedIssuers;
  return asArray(issuers).map((issuer) => asRecord(issuer) as TrustedIssuerMetadata);
}

export function getRequiredClaimTopics(asset: RWAAsset): string[] {
  const metadataTopics = topicStrings(asset.metadata?.claimTopics);
  if (metadataTopics.length > 0) return [...new Set(metadataTopics)];

  const issuerTopics = getTrustedIssuers(asset).flatMap((issuer) =>
    topicStrings(issuer.topics),
  );
  if (issuerTopics.length > 0) return [...new Set(issuerTopics)];

  return [
    ...(asset.kycRequired ? ["1"] : []),
    ...(asset.amlRequired ? ["2"] : []),
  ];
}

export function getComplianceModuleParams(asset: RWAAsset) {
  return asRecord(asset.metadata?.complianceModuleParams);
}

export function getModuleParams(asset: RWAAsset, moduleProgramId: string) {
  return asRecord(getComplianceModuleParams(asset)[moduleProgramId]);
}

export function hasCountryAllowedModule(asset: RWAAsset): boolean {
  const params = getModuleParams(asset, MOD_COUNTRY_RESTRICT.toBase58());
  return Object.prototype.hasOwnProperty.call(params, "allowed_countries");
}

export function getAllowedCountries(asset: RWAAsset): number[] {
  const params = getModuleParams(asset, MOD_COUNTRY_RESTRICT.toBase58());
  return parseNumberList(params.allowed_countries);
}

export function isInvestorCountryAllowed(asset: RWAAsset, country?: number | null) {
  if (!hasCountryAllowedModule(asset)) {
    return true;
  }
  if (country === null || country === undefined || !Number.isFinite(country)) {
    return false;
  }
  return getAllowedCountries(asset).includes(Math.trunc(country));
}

export function getComplianceRuleRows(asset: RWAAsset): ComplianceRuleRow[] {
  const paramsByModule = getComplianceModuleParams(asset);

  return Object.entries(paramsByModule).flatMap(([moduleProgramId, rawParams]) => {
    const definition = MODULE_LABELS.get(moduleProgramId);
    const params = asRecord(rawParams);
    if (!definition) return [];

    if (moduleProgramId === MOD_COUNTRY_RESTRICT.toBase58()) {
      const countries = parseNumberList(params.allowed_countries);
      return [
        {
          id: definition.id,
          label: definition.name,
          description: definition.description,
          value: countries.length > 0 ? countries.join(", ") : "No countries allowed",
        },
      ];
    }

    if (moduleProgramId === MOD_COUNTRY_CAP.toBase58()) {
      const caps = parseCountryCaps(params.country_caps);
      return [
        {
          id: definition.id,
          label: definition.name,
          description: definition.description,
          value:
            caps.length > 0
              ? caps.map((cap) => `${cap.country}: ${cap.cap}`).join(", ")
              : "Not configured",
        },
      ];
    }

    const key =
      moduleProgramId === MOD_MAX_INVESTORS.toBase58()
        ? "max_investors"
        : moduleProgramId === MOD_MAX_BALANCE.toBase58()
          ? "max_balance"
          : moduleProgramId === MOD_MAX_TRANSFER.toBase58()
            ? "max_amount"
            : moduleProgramId === MOD_LOCKUP.toBase58()
              ? "lockup_end"
              : moduleProgramId === MOD_DAILY_LIMIT.toBase58()
                ? "daily_limit"
                : moduleProgramId === MOD_SUPPLY_CAP.toBase58()
                  ? "max_supply"
                  : "";

    return [
      {
        id: definition.id,
        label: definition.name,
        description: definition.description,
        value: key ? String(params[key] ?? "Not configured") : "Configured",
      },
    ];
  });
}
