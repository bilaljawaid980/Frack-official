"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import * as ISO3166 from "iso-3166-1";
import { motion } from "framer-motion";
import {
  Shield,
  Trash2,
  Loader2,
  Rocket,
  FileText,
  Upload,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  DollarSign,
  Building2,
  Info,
  ExternalLink
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

import { useWallet } from "@/hooks/use-wallet";
import { toast } from "sonner";
import {
  useDeployTokenSuite,
  useFactoryState,
} from "@/hooks/useFactory";
import { COMPLIANCE_MODULES, FACTORY_PROGRAM_ID, SANDBOX_AUTHORITY_TOPICS } from "@/lib/constants";
import { generateSalt, isValidPublicKey } from "@/lib/utils";
import { PublicKey, Keypair } from "@solana/web3.js";
import { queryCache } from "@/lib/query-cache";
import { apiFetch } from "@/lib/backend";
import { TransactionToastLink } from "@/lib/solscan";

async function parseApiResponse(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || fallback);
  }
  return payload;
}

/** Derives the canonical FID PDA from a wallet address for the active FID program. */
function deriveFidFromWallet(
  walletAddress: string,
  fidProgramId?: PublicKey,
): string {
  try {
    if (!fidProgramId) return "";
    const wallet = new PublicKey(walletAddress);
    const [fid] = PublicKey.findProgramAddressSync(
      [Buffer.from("fid"), wallet.toBuffer()],
      fidProgramId
    );
    return fid.toBase58();
  } catch {
    return "";
  }
}

// Form validation schema updated for Factory deployment
const issuanceSchema = z.object({
  assetDetails: z.object({
    name: z.string().min(3, "Name must be at least 3 characters").max(32, "Max 32 characters"),
    symbol: z
      .string()
      .min(2, "Symbol must be at least 2 characters")
      .max(8, "Max 8 characters")
      .transform((v) => v.toUpperCase()),
    description: z.string().min(10, "Description must be at least 10 characters"),
    assetType: z.enum([
      "real-estate",
      "commodity",
      "equity",
      "debt",
      "art",
      "intellectual-property",
    ]),
    underlyingValue: z.number().min(1000, "Value must be at least $1,000"),
    totalSupply: z.number().min(1, "Must issue at least 1 token"),
    location: z.string().min(2, "Location is required"),
    currency: z.string(),
    issuerWallet: z.string().refine(isValidPublicKey, "Enter a valid wallet address"),
    custodianWallet: z.string().refine(isValidPublicKey, "Enter a valid custodian wallet"),
    factoryAssetId: z.coerce.number().int().positive("Asset ID must be positive"),
    isin: z.string().min(1, "ISIN is required").max(12, "Max 12 characters").transform((v) => v.toUpperCase()),
  }),
  complianceRequirements: z.object({
    claimTopics: z.array(z.string().regex(/^\d+$/, "Must be a number")).min(1, "At least one topic required"),
    trustedIssuers: z.array(z.object({
      walletAddress: z.string().refine(isValidPublicKey, "Invalid wallet"),
      issuerFid: z.string(),
      topics: z.array(z.bigint()).min(1, "At least one topic required"),
      label: z.string().min(1, "Label required"),
    })),
    selectedModules: z.array(z.string()),
    moduleParams: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  }),
  tokenDetails: z.object({
    decimals: z.number().min(0).max(18).default(6),
    initialPrice: z.number().min(0.01, "Price must be at least $0.01"),
  }),
  documents: z.array(z.any()).default([]),
});

export type IssuanceFormValues = z.infer<typeof issuanceSchema>;
export type UploadedLegalDocument = {
  file: File;
  documentType: string;
};

export type StoredLegalDocument = {
  name: string;
  size?: number;
  type?: string;
  documentType?: string;
  bucket?: string;
  path?: string;
  publicUrl?: string;
};

const DOCUMENT_TYPE_OPTIONS = [
  { value: "asset_document", label: "Asset Document" },
  { value: "title_deed", label: "Title Deed / Ownership Proof" },
  { value: "valuation_report", label: "Valuation Report" },
  { value: "id_card", label: "ID Card" },
  { value: "passport", label: "Passport" },
  { value: "proof_of_address", label: "Proof of Address" },
  { value: "other", label: "Other Legal Document" },
];

const CLAIM_TOPIC_OPTIONS = [
  { value: "1", label: "KYC", description: "Know Your Customer verification" },
  { value: "2", label: "AML", description: "Anti-Money Laundering screening" },
  ...SANDBOX_AUTHORITY_TOPICS.map((topic) => ({
    value: String(topic.id),
    label: topic.label,
    description: topic.description,
  })),
];

type TrustedIssuerRecord = {
  id: string;
  walletAddress: string;
  authorityName: string;
  kycAuthorized: boolean;
  amlAuthorized: boolean;
};

type IsoCountryRecord = {
  country?: string;
  name?: string;
  alpha2?: string;
  numeric?: string | number;
};

type CountryOption = {
  alpha2: string;
  name: string;
  numeric: number;
};

type CountryCapEntry = {
  countryCode: number;
  cap: string;
};

const COUNTRY_OPTIONS: CountryOption[] = (ISO3166.all() as IsoCountryRecord[])
  .map((country) => {
    const alpha2 = country.alpha2?.toUpperCase() ?? "";
    const numeric = Number(country.numeric);
    const name = country.country ?? country.name ?? "";

    if (!alpha2 || !name || !Number.isInteger(numeric)) return null;
    return { alpha2, name, numeric };
  })
  .filter((country): country is CountryOption => Boolean(country))
  .sort((left, right) => left.name.localeCompare(right.name));

const COUNTRY_BY_NUMERIC = new Map(
  COUNTRY_OPTIONS.map((country) => [country.numeric, country]),
);

function countryFlagUrl(alpha2: string) {
  return `https://flagcdn.com/w40/${alpha2.toLowerCase()}.png`;
}

function CountryFlag({ country }: { country: Pick<CountryOption, "alpha2" | "name"> }) {
  return (
    <span
      aria-label={`${country.name} flag`}
      className="inline-block h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] bg-slate-100 bg-cover bg-center shadow-sm ring-1 ring-slate-900/10"
      role="img"
      style={{ backgroundImage: `url("${countryFlagUrl(country.alpha2)}")` }}
    />
  );
}

function parseCountryList(value: unknown) {
  return String(value ?? "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function serializeCountryList(countries: number[]) {
  return Array.from(new Set(countries)).join(",");
}

function parseCountryCapEntries(value: unknown): CountryCapEntry[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => {
      const [country, cap] = entry.split(":");
      const countryCode = Number(country?.trim());
      const normalizedCap = cap?.trim() ?? "";
      if (!Number.isInteger(countryCode) || countryCode <= 0 || !normalizedCap) {
        return null;
      }
      return { countryCode, cap: normalizedCap };
    })
    .filter((entry): entry is CountryCapEntry => Boolean(entry));
}

function serializeCountryCapEntries(entries: CountryCapEntry[]) {
  return entries
    .filter(
      (entry) =>
        Number.isInteger(entry.countryCode) &&
        entry.countryCode > 0 &&
        /^\d+$/.test(entry.cap) &&
        Number(entry.cap) > 0,
    )
    .map((entry) => `${entry.countryCode}:${entry.cap}`)
    .join(",");
}

function CountrySelectValue({ country }: { country?: CountryOption }) {
  if (!country) return <SelectValue placeholder="Select country" />;
  return (
    <span className="flex min-w-0 items-center gap-2 pr-2">
      <CountryFlag country={country} />
      <span className="truncate">{country.name}</span>
      <span className="shrink-0 text-xs text-slate-400">{country.numeric}</span>
    </span>
  );
}

function CountryOptionRow({ country }: { country: CountryOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <CountryFlag country={country} />
      <span className="truncate">{country.name}</span>
      <span className="shrink-0 text-xs text-slate-400">{country.numeric}</span>
    </span>
  );
}

function AllowedCountriesField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string) => void;
}) {
  const selectedCountries = parseCountryList(value);
  const selectedSet = new Set(selectedCountries);

  return (
    <div className="space-y-2">
      <Select
        value=""
        onValueChange={(nextValue) => {
          const countryCode = Number(nextValue);
          if (!Number.isInteger(countryCode)) return;
          onChange(serializeCountryList([...selectedCountries, countryCode]));
        }}
      >
        <SelectTrigger className="h-9 bg-white text-sm">
          <SelectValue placeholder="Add allowed country" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectGroup>
            {COUNTRY_OPTIONS.map((country) => (
              <SelectItem
                key={`${country.alpha2}-${country.numeric}`}
                disabled={selectedSet.has(country.numeric)}
                textValue={`${country.name} ${country.numeric}`}
                value={String(country.numeric)}
              >
                <CountryOptionRow country={country} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {selectedCountries.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedCountries.map((countryCode) => {
            const country = COUNTRY_BY_NUMERIC.get(countryCode);
            return (
              <button
                key={countryCode}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                type="button"
                onClick={() =>
                  onChange(
                    serializeCountryList(
                      selectedCountries.filter((item) => item !== countryCode),
                    ),
                  )
                }
              >
                {country ? <CountryFlag country={country} /> : null}
                {country ? country.name : `Country ${countryCode}`}
                <span className="text-slate-400">{countryCode}</span>
                <span className="text-slate-400">x</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CountryCapsField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string) => void;
}) {
  const entries = parseCountryCapEntries(value);

  const updateEntries = (nextEntries: CountryCapEntry[]) => {
    onChange(serializeCountryCapEntries(nextEntries));
  };

  return (
    <div className="space-y-2">
      {entries.map((entry, index) => {
        const country = COUNTRY_BY_NUMERIC.get(entry.countryCode);
        return (
          <div key={`${entry.countryCode}-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
            <Select
              value={String(entry.countryCode)}
              onValueChange={(nextValue) => {
                const countryCode = Number(nextValue);
                if (!Number.isInteger(countryCode)) return;
                updateEntries(
                  entries.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, countryCode } : item,
                  ),
                );
              }}
            >
              <SelectTrigger className="h-9 bg-white text-sm">
                <CountrySelectValue country={country} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectGroup>
                  {COUNTRY_OPTIONS.map((option) => (
                    <SelectItem
                      key={`${option.alpha2}-${option.numeric}`}
                      disabled={entries.some(
                        (item, itemIndex) =>
                          itemIndex !== index && item.countryCode === option.numeric,
                      )}
                      textValue={`${option.name} ${option.numeric}`}
                      value={String(option.numeric)}
                    >
                      <CountryOptionRow country={option} />
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input
              className="h-9 bg-white text-sm"
              inputMode="numeric"
              min={1}
              placeholder="Cap"
              type="number"
              value={entry.cap}
              onChange={(event) => {
                const cap = event.target.value.replace(/\D/g, "");
                updateEntries(
                  entries.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, cap } : item,
                  ),
                );
              }}
            />
            <Button
              className="h-9"
              type="button"
              variant="outline"
              onClick={() => updateEntries(entries.filter((_, itemIndex) => itemIndex !== index))}
            >
              Remove
            </Button>
          </div>
        );
      })}

      <Button
        className="h-9"
        type="button"
        variant="outline"
        onClick={() => {
          const firstUnusedCountry =
            COUNTRY_OPTIONS.find(
              (country) => !entries.some((entry) => entry.countryCode === country.numeric),
            ) ?? COUNTRY_OPTIONS[0];
          if (!firstUnusedCountry) return;
          updateEntries([...entries, { countryCode: firstUnusedCountry.numeric, cap: "1" }]);
        }}
      >
        Add Country Cap
      </Button>
    </div>
  );
}

function getAuthorizedTopicValues(issuer: TrustedIssuerRecord) {
  return [
    issuer.kycAuthorized ? "1" : null,
    issuer.amlAuthorized ? "2" : null,
  ].filter((topic): topic is string => Boolean(topic));
}

function getAuthorizedTopicLabel(issuer: TrustedIssuerRecord) {
  return getAuthorizedTopicValues(issuer)
    .map((topic) => (topic === "1" ? "KYC topic 1" : "AML topic 2"))
    .join(", ");
}

function formatDocumentType(value?: string) {
  if (!value) return "Document";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatFileSize(size?: number) {
  if (!size || !Number.isFinite(size)) return "";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function IssuanceForm({
  onSubmitOverride,
  onUploadDocuments,
  isApplicationMode = false,
  onDeployed,
  initialValues,
  deploymentRequestId,
  submitLabel,
  existingDocuments = [],
  documentsReadOnly = false,
  requireDocumentApproval = false,
}: {
  onSubmitOverride?: (
    data: IssuanceFormValues,
    uploadedDocuments: UploadedLegalDocument[],
    storedDocuments: StoredLegalDocument[],
  ) => Promise<void>;
  onUploadDocuments?: (
    data: IssuanceFormValues,
    uploadedDocuments: UploadedLegalDocument[],
  ) => Promise<StoredLegalDocument[]>;
  isApplicationMode?: boolean;
  onDeployed?: () => Promise<void> | void;
  initialValues?: Partial<IssuanceFormValues>;
  deploymentRequestId?: string;
  submitLabel?: string;
  existingDocuments?: StoredLegalDocument[];
  documentsReadOnly?: boolean;
  requireDocumentApproval?: boolean;
} = {}) {
  const { address } = useWallet();
  const router = useRouter();
  const [uploadedDocuments, setUploadedDocuments] = useState<
    UploadedLegalDocument[]
  >([]);
  const [storedUploadedDocuments, setStoredUploadedDocuments] = useState<
    StoredLegalDocument[]
  >([]);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [documentsApproved, setDocumentsApproved] = useState(false);
  const [trustedIssuerRecords, setTrustedIssuerRecords] = useState<TrustedIssuerRecord[]>([]);
  const [trustedIssuersLoading, setTrustedIssuersLoading] = useState(false);
  const [trustedIssuerSelection, setTrustedIssuerSelection] = useState("");
  const isVerified = true;
  const hasOnchainId = true;
  const identityLoading = false;

  // Generate a session-stable mint keypair
  const [mintKeypair] = useState(() => Keypair.generate());

  // Factory Hooks
  const { data: factoryState, isLoading: factoryLoading } = useFactoryState();
  const { mutate: deployTokenSuite, isPending: deploying } = useDeployTokenSuite();

  const form = useForm<IssuanceFormValues>({
    resolver: zodResolver(issuanceSchema) as any,
    defaultValues: {
      assetDetails: {
        name: "",
        symbol: "",
        description: "",
        assetType: "real-estate",
        underlyingValue: 100000,
        totalSupply: 1000000,
        location: "",
        currency: "USD",
        issuerWallet: address || "",
        custodianWallet: address || "",
        factoryAssetId: Math.floor(Date.now() / 1000),
        isin: "",
      },
      complianceRequirements: {
        claimTopics: ["1"],
        trustedIssuers: [],
        selectedModules: [],
        moduleParams: {},
      },
      tokenDetails: {
        decimals: 6,
        initialPrice: 1.0,
      },
      documents: [],
    },
  });
  const requiredClaimTopics = useWatch({
    control: form.control,
    name: "complianceRequirements.claimTopics",
  }) || [];
  const selectedTrustedIssuers = useWatch({
    control: form.control,
    name: "complianceRequirements.trustedIssuers",
  }) || [];
  const selectedComplianceModules =
    useWatch({
      control: form.control,
      name: "complianceRequirements.selectedModules",
    }) || [];
  const complianceModuleParams =
    (useWatch({
      control: form.control,
      name: "complianceRequirements.moduleParams",
    }) as Record<string, Record<string, unknown>> | undefined) || {};

  const configuredPlatformOwner = process.env.NEXT_PUBLIC_PLATFORM_OWNER || "";
  const isConfiguredPlatformOwner =
    !!address && !!configuredPlatformOwner && address === configuredPlatformOwner;
  const factoryOwner = factoryState?.owner || "";
  const isPlatformAdmin = !!address && !!factoryOwner && address === factoryOwner;
  const hasFactoryOwnerMismatch =
    !!configuredPlatformOwner && !!factoryOwner && configuredPlatformOwner !== factoryOwner;
  const formSteps = isApplicationMode
    ? [
        { id: 1, label: "Asset Details" },
        { id: 2, label: "Compliance" },
        { id: 3, label: "Documents" },
      ]
    : [
        { id: 1, label: "Asset Details" },
        { id: 2, label: "Valuation" },
        { id: 3, label: "Compliance" },
        { id: 4, label: "Tokenization" },
      ];
  const finalStep = formSteps[formSteps.length - 1]?.id ?? 1;

  useEffect(() => {
    if (address && !form.getValues("assetDetails.issuerWallet")) {
      form.setValue("assetDetails.issuerWallet", address);
    }
    if (address && !form.getValues("assetDetails.custodianWallet")) {
      form.setValue("assetDetails.custodianWallet", address);
    }
  }, [address, form]);

  useEffect(() => {
    if (!initialValues) return;
    form.reset({
      assetDetails: {
        ...form.getValues("assetDetails"),
        ...initialValues.assetDetails,
      },
      complianceRequirements: {
        ...form.getValues("complianceRequirements"),
        ...initialValues.complianceRequirements,
      },
      tokenDetails: {
        ...form.getValues("tokenDetails"),
        ...initialValues.tokenDetails,
      },
      documents: initialValues.documents || [],
    });
  }, [form, initialValues]);

  useEffect(() => {
    if (existingDocuments.length === 0) return;
    form.setValue("documents", existingDocuments);
  }, [existingDocuments, form]);

  useEffect(() => {
    setCurrentStep(1);
    setUploadedDocuments([]);
    setStoredUploadedDocuments([]);
    setDocumentsApproved(false);
  }, [deploymentRequestId, isApplicationMode]);

  useEffect(() => {
    const loadTrustedIssuers = async () => {
      setTrustedIssuersLoading(true);
      try {
        setTrustedIssuerRecords(await apiFetch<TrustedIssuerRecord[]>("/trusted-issuers"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load trusted issuers.");
      } finally {
        setTrustedIssuersLoading(false);
      }
    };

    void loadTrustedIssuers();
  }, []);

  const toggleClaimTopic = (topic: string) => {
    const currentTopics = form.getValues("complianceRequirements.claimTopics");
    const nextTopics = currentTopics.includes(topic)
      ? currentTopics.filter((item) => item !== topic)
      : [...currentTopics, topic];
    form.setValue("complianceRequirements.claimTopics", nextTopics, { shouldValidate: true });

    const currentIssuers = form.getValues("complianceRequirements.trustedIssuers");
    form.setValue(
      "complianceRequirements.trustedIssuers",
      currentIssuers
        .map((issuer) => {
          const registryIssuer = trustedIssuerRecords.find(
            (record) => record.walletAddress === issuer.walletAddress,
          );
          const authorizedTopics = registryIssuer
            ? getAuthorizedTopicValues(registryIssuer)
            : issuer.topics.map((item) => item.toString());
          return {
            ...issuer,
            topics: authorizedTopics
              .filter((item) => nextTopics.includes(item))
              .map((item) => BigInt(item)),
          };
        })
        .filter((issuer) => issuer.topics.length > 0),
      { shouldValidate: true },
    );
  };

  const addTrustedIssuer = (walletAddress: string) => {
    const issuer = trustedIssuerRecords.find((item) => item.walletAddress === walletAddress);
    if (!issuer) return;

    const currentIssuers = form.getValues("complianceRequirements.trustedIssuers");
    if (currentIssuers.some((item) => item.walletAddress === walletAddress)) {
      toast.error("This trusted issuer has already been selected.");
      setTrustedIssuerSelection("");
      return;
    }

    const requiredTopics = form.getValues("complianceRequirements.claimTopics");
    const topics = getAuthorizedTopicValues(issuer)
      .filter((topic) => requiredTopics.includes(topic))
      .map((topic) => BigInt(topic));
    if (topics.length === 0) {
      toast.error("This issuer is not authorized for any currently required claim topic.");
      setTrustedIssuerSelection("");
      return;
    }

    form.setValue(
      "complianceRequirements.trustedIssuers",
      [
        ...currentIssuers,
        {
          walletAddress: issuer.walletAddress,
          issuerFid: deriveFidFromWallet(
            issuer.walletAddress,
            factoryState?.fidProgramId ? new PublicKey(factoryState.fidProgramId) : undefined,
          ),
          topics,
          label: issuer.authorityName,
        },
      ],
      { shouldValidate: true },
    );
    setTrustedIssuerSelection("");
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const validFiles = files.filter((file) => {
      const validTypes = ["application/pdf", "image/jpeg", "image/png"];
      return validTypes.includes(file.type) && file.size <= 10 * 1024 * 1024;
    });

    const nextDocuments = [
      ...uploadedDocuments,
      ...validFiles.map((file) => ({
        file,
        documentType: "asset_document",
      })),
    ];
    setUploadedDocuments(nextDocuments);
    setStoredUploadedDocuments([]);
    form.setValue(
      "documents",
      nextDocuments.map((document) => document.file),
    );
    event.target.value = "";
  };

  const removeFile = (index: number) => {
    const nextDocuments = uploadedDocuments.filter(
      (_, i: number) => i !== index,
    );
    setUploadedDocuments(nextDocuments);
    setStoredUploadedDocuments([]);
    form.setValue(
      "documents",
      nextDocuments.map((document) => document.file),
    );
  };

  const updateDocumentType = (index: number, documentType: string) => {
    const nextDocuments = uploadedDocuments.map((document, i) =>
      i === index ? { ...document, documentType } : document,
    );
    setUploadedDocuments(nextDocuments);
    setStoredUploadedDocuments([]);
  };

  const uploadSelectedDocuments = async () => {
    if (!onUploadDocuments) return;
    if (uploadedDocuments.length === 0) {
      toast.error("Attach at least one legal document before uploading.");
      return;
    }

    const fieldsToValidate = isApplicationMode
      ? [...getStepFields(1), ...getStepFields(2), "documents"]
      : ["documents"];
    const isValid = await form.trigger(fieldsToValidate);
    if (!isValid) return;

    setUploadingDocuments(true);
    try {
      const documents = await onUploadDocuments(
        form.getValues(),
        uploadedDocuments,
      );
      if (documents.length === 0) {
        throw new Error("No documents were uploaded.");
      }
      setStoredUploadedDocuments(documents);
      form.setValue("documents", documents);
      toast.success("Documents uploaded. You can now submit the request.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Document upload failed.";
      toast.error(message);
    } finally {
      setUploadingDocuments(false);
    }
  };

  const onSubmit = async (data: IssuanceFormValues) => {
    if (currentStep < finalStep) {
      await nextStep();
      return;
    }

    if (isApplicationMode && uploadedDocuments.length === 0) {
      toast.error("Upload at least one legal document before submitting.");
      setCurrentStep(finalStep);
      return;
    }

    if (
      isApplicationMode &&
      onUploadDocuments &&
      storedUploadedDocuments.length === 0
    ) {
      toast.error("Upload the selected legal documents before submitting.");
      setCurrentStep(finalStep);
      return;
    }

    if (requireDocumentApproval) {
      if (existingDocuments.length === 0) {
        toast.error("No issuer documents are attached to this request.");
        setCurrentStep(finalStep);
        return;
      }
      if (!documentsApproved) {
        toast.error("Review and approve the issuer documents before deployment.");
        setCurrentStep(finalStep);
        return;
      }
    }

    if (onSubmitOverride) {
      await onSubmitOverride(data, uploadedDocuments, storedUploadedDocuments);
      return;
    }

    if (!isPlatformAdmin && !isApplicationMode) {
      toast.error("Only the platform admin can deploy new tokens", {
        description: "Connect with the factory owner wallet.",
      });
      return;
    }

    const salt = generateSalt();
    const priceScale = 10 ** data.tokenDetails.decimals;
    const pricePerToken = BigInt(
      Math.round(data.tokenDetails.initialPrice * priceScale)
    );
    if (!factoryState?.fidProgramId) {
      toast.error("Factory state is still loading. Try again in a moment.");
      return;
    }
    const activeFidProgramId = new PublicKey(factoryState.fidProgramId);

    const trustedIssuers = data.complianceRequirements.trustedIssuers.map(
      (issuer) => ({
        ...issuer,
        issuerFid: deriveFidFromWallet(issuer.walletAddress, activeFidProgramId),
      }),
    );
    const invalidRegistryIssuer = trustedIssuers.find((issuer) => {
      const registryIssuer = trustedIssuerRecords.find(
        (record) => record.walletAddress === issuer.walletAddress,
      );
      if (!registryIssuer) return true;
      const authorizedTopics = getAuthorizedTopicValues(registryIssuer);
      return issuer.topics.some((topic) => !authorizedTopics.includes(topic.toString()));
    });
    if (invalidRegistryIssuer) {
      toast.error("Each trusted issuer must be selected from Personnel and authorized for its assigned topics.");
      return;
    }
    const missingIssuerTopic = data.complianceRequirements.claimTopics.find(
      (topic) => !trustedIssuers.some((issuer) => issuer.topics.some((item) => item.toString() === topic)),
    );
    if (missingIssuerTopic) {
      toast.error(`Select an approved trusted issuer for required claim topic ${missingIssuerTopic}.`);
      return;
    }
    if (trustedIssuers.some((issuer) => !issuer.issuerFid)) {
      toast.error("One or more trusted issuer wallets could not be resolved to an active FID PDA.");
      return;
    }

    deployTokenSuite(
      {
        mintKeypair,
        assetId: BigInt(data.assetDetails.factoryAssetId),
        issuer: data.assetDetails.issuerWallet,
        tokenMint: mintKeypair.publicKey.toBase58(),
        custodian: data.assetDetails.custodianWallet,
        tokenName: data.assetDetails.name,
        tokenSymbol: data.assetDetails.symbol,
        decimals: data.tokenDetails.decimals,
        isin: data.assetDetails.isin,
        claimTopics: data.complianceRequirements.claimTopics.map((t: string) => BigInt(t)),
        trustedIssuers,
        complianceModules: data.complianceRequirements.selectedModules,
        complianceModuleParams: data.complianceRequirements.moduleParams,
        sharedIrs: null,
        salt,
      },
      {
        onSuccess: async (sig: string) => {
          const response = await fetch("/api/rwa/deployed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tokenContract: mintKeypair.publicKey.toBase58(),
              name: data.assetDetails.name,
              symbol: data.assetDetails.symbol,
              description: data.assetDetails.description,
              issuerWallet: data.assetDetails.issuerWallet,
              legalOwner: data.assetDetails.issuerWallet,
              referenceId: data.assetDetails.isin,
              deployedAt: new Date().toISOString(),
              lifecycleState: "ISSUED",
              metadata: {
                assetType: data.assetDetails.assetType,
                currency: data.assetDetails.currency,
                location: data.assetDetails.location,
                underlyingValue: data.assetDetails.underlyingValue,
                totalSupply: data.assetDetails.totalSupply,
                initialPrice: data.tokenDetails.initialPrice,
                pricePerToken: pricePerToken.toString(),
                priceDecimals: data.tokenDetails.decimals,
                paymentMint: null,
                decimals: data.tokenDetails.decimals,
                isin: data.assetDetails.isin,
                factoryAssetId: data.assetDetails.factoryAssetId,
                custodianWallet: data.assetDetails.custodianWallet,
                claimTopics: data.complianceRequirements.claimTopics,
                trustedIssuers: trustedIssuers.map((issuer) => ({
                  ...issuer,
                  topics: issuer.topics.map((topic) => topic.toString()),
                })),
                complianceModules: data.complianceRequirements.selectedModules,
                complianceModuleParams: data.complianceRequirements.moduleParams,
                documents: existingDocuments,
                documentsApproved: requireDocumentApproval
                  ? {
                      approved: documentsApproved,
                      approvedBy: address || null,
                      approvedAt: new Date().toISOString(),
                    }
                  : null,
                txHash: sig,
                salt,
              },
            }),
          });
          await parseApiResponse(
            response,
            "Token deployed but failed to persist the asset record.",
          );
          if (deploymentRequestId) {
            await apiFetch(`/asset-requests/${deploymentRequestId}/status`, {
              method: "PATCH",
              body: JSON.stringify({
                status: "DEPLOYED",
                deployedAssetId: mintKeypair.publicKey.toBase58(),
                txHash: sig,
                reviewedBy: address || undefined,
              }),
            });
          }
          queryCache.invalidatePrefix("assets:");
          await onDeployed?.();
          toast.success("Token suite deployed successfully.", {
            description: <TransactionToastLink signature={sig} />,
          });
          router.push("/issuer");
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : "Unknown error";
          toast.error("Deployment failed: " + message);
        },
      }
    );
  };

  const nextStep = async () => {
    // Validate current step before proceeding
    const fieldsToValidate = getStepFields(currentStep);
    const isValid = await form.trigger(fieldsToValidate);
    if (isValid) {
      setCurrentStep((prev) => Math.min(prev + 1, finalStep));
    }
  };

  const prevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const canBypassVerification = isPlatformAdmin || isApplicationMode;


  // Check if user is verified before allowing issuance (factory admin can proceed)
  if (
    !identityLoading &&
    !factoryLoading &&
    !isVerified &&
    !canBypassVerification
  ) {
    return (
      <Card className="max-w-2xl mx-auto mt-8">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-yellow-500" />
            <CardTitle>Verification Required</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            You must complete identity verification before issuing security
            tokens. This ensures compliance with securities regulations.
          </p>

          {!hasOnchainId ? (
            <>
              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm font-medium mb-2">What you need to do:</p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Create your OnchainID</li>
                  <li>Register with your country</li>
                  <li>Wait for admin to add verification claims (KYC, AML)</li>
                  <li>Return here to issue tokens</li>
                </ol>
              </div>
              <Button
                className="w-full"
                size="lg"
                onClick={() => router.push("/identity")}
              >
                <Shield className="mr-2 h-4 w-4" />
                Complete Verification
              </Button>
            </>
          ) : (
            <>
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                <p className="text-sm font-medium text-yellow-800 mb-1">
                  ⏳ Verification Pending
                </p>
                <p className="text-sm text-yellow-700">
                  Your OnchainID is created and registered. Waiting for platform
                  admin to add verification claims (KYC, AML). This typically
                  takes 1-2 business days.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => router.push("/identity")}
                >
                  View Identity Status
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() =>
                    (window.location.href = "mailto:support@example.com")
                  }
                >
                  Contact Support
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  const getStepFields = (step: number): any[] => {
    if (isApplicationMode) {
      if (step === 1) {
        return [
          "assetDetails.name",
          "assetDetails.symbol",
          "assetDetails.description",
          "assetDetails.assetType",
          "assetDetails.location",
          "assetDetails.issuerWallet",
          "assetDetails.isin",
        ];
      }
      if (step === 2) {
        return ["complianceRequirements.selectedModules"];
      }
      if (step === 3) return ["documents"];
      return [];
    }

    switch (step) {
      case 1:
        return [
          "assetDetails.name",
          "assetDetails.symbol",
          "assetDetails.description",
          "assetDetails.assetType",
          "assetDetails.location",
          "assetDetails.issuerWallet",
          "assetDetails.isin",
        ];
      case 2:
        return [
          "assetDetails.underlyingValue",
          "assetDetails.totalSupply",
        ];
      case 3:
        return [
          "complianceRequirements.claimTopics",
          "complianceRequirements.trustedIssuers",
          "complianceRequirements.selectedModules",
        ];
      case 4:
        return [
          "tokenDetails.initialPrice",
          "tokenDetails.decimals",
          "documents",
        ];
      default:
        return [];
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full mx-auto"
    >
      {/* Platform Authority Notice */}
      {!isApplicationMode && (
        <Card className="mb-8 border-2 border-slate-200 bg-white/50 backdrop-blur-sm shadow-[0_4px_24px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full"/>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3 text-slate-900">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#172E7F] to-[#2A5FA6] text-white shadow-md">
                <Shield className="h-5 w-5" />
              </div>
              Platform Authority Verification
            </CardTitle>
            <CardDescription>
              Deployment of new regulated token suites requires platform owner authorization.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Factory Program</div>
                <div className="font-mono text-xs text-slate-700 truncate">
                  {FACTORY_PROGRAM_ID.toBase58()}
                </div>
              </div>
              <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">On-chain Factory Owner</div>
                <div className="font-mono text-xs text-slate-700 truncate">
                  {factoryState?.owner || "Loading..."}
                </div>
              </div>
            </div>

            {address && !factoryLoading && (
              <div
                className={`p-4 rounded-xl flex items-center gap-3 border-2 transition-all duration-300 ${
                  isPlatformAdmin
                    ? "bg-emerald-50/50 border-emerald-500/20 text-emerald-700"
                    : "bg-amber-50/50 border-amber-500/20 text-amber-700"
                }`}
              >
                <div className={`p-1.5 rounded-full ${isPlatformAdmin ? "bg-emerald-500/20" : "bg-amber-500/20"}`}>
                  {isPlatformAdmin ? <CheckCircle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                </div>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">
                    {isPlatformAdmin
                      ? "Authorization verified. You are connected as the on-chain factory owner."
                      : "Only the on-chain factory owner can deploy token suites."}
                  </div>
                  {!isPlatformAdmin && (
                    <div className="text-xs font-medium">
                      {isConfiguredPlatformOwner && hasFactoryOwnerMismatch
                        ? "NEXT_PUBLIC_PLATFORM_OWNER does not match the factory owner stored on-chain. Update factory ownership on-chain or point the frontend to the correct factory program."
                        : "Switch to the factory owner wallet shown above. The .env value alone cannot authorize deployment."}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {/* Step Indicator */}
      {isApplicationMode ? (
        <div className="mb-8 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 shadow-sm">
          <div className="grid grid-cols-3 gap-2">
            {formSteps.map((step, index) => {
              const isActive = currentStep === step.id;
              const isDone = currentStep > step.id;
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-colors ${
                    isActive
                      ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                      : isDone
                        ? "bg-white/70 text-slate-700"
                        : "text-slate-500"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      isDone || isActive
                        ? "bg-gradient-to-br from-[#172E7F] to-[#2A5FA6] text-white shadow-[0_4px_12px_rgba(23,46,127,0.18)]"
                        : "border border-slate-300 bg-white text-slate-400"
                    }`}
                  >
                    {isDone ? <CheckCircle className="h-4 w-4" /> : index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Step {index + 1}
                    </div>
                    <div className="truncate text-sm font-bold">
                      {step.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            {formSteps.map((step, index) => (
              <div key={step.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                      step.id <= currentStep
                        ? "bg-gradient-to-br from-[#172E7F] to-[#2A5FA6] text-white shadow-[0_4px_12px_rgba(23,46,127,0.25)]"
                        : "bg-slate-100 text-slate-400 border-2 border-slate-200"
                    }`}
                  >
                    {step.id < currentStep ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : (
                      index + 1
                    )}
                  </div>
                </div>
                {index < formSteps.length - 1 && (
                  <div className="flex-1 h-1 mx-2">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        step.id < currentStep
                          ? "bg-gradient-to-r from-[#172E7F] to-[#2A5FA6]"
                          : "bg-slate-200"
                      }`}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {formSteps.map((step) => (
              <div
                key={step.id}
                className={`text-sm font-semibold transition-colors ${
                  currentStep >= step.id ? "text-slate-900" : "text-slate-400"
                }`}
              >
                {step.label}
              </div>
            ))}
          </div>
        </div>
      )}

      <Form {...form}>
        <form
          onSubmit={(event) => {
            if (currentStep < finalStep) {
              event.preventDefault();
              void nextStep();
              return;
            }
            void form.handleSubmit(onSubmit)(event);
          }}
          className="space-y-8"
        >
          {/* Step 1: Asset Information */}
          {currentStep === 1 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h3 className="text-lg font-bold flex items-center gap-2 text-slate-900">
                <Building2 className="h-5 w-5 text-[#172E7F]" />
                Identity & Basic Details
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="assetDetails.name"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Tokenized Asset Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. London Real Estate Fund"
                          className="h-11"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="assetDetails.symbol"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Token Symbol</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. LREF" className="h-11" {...field} />
                      </FormControl>
                      <FormDescription>
                        Unique ticker (max 8 characters)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!isApplicationMode ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="assetDetails.factoryAssetId"
                      render={({ field }: { field: any }) => (
                        <FormItem>
                          <FormLabel>Factory Asset ID</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(event) => field.onChange(Number(event.target.value))}
                            />
                          </FormControl>
                          <FormDescription>
                            Used to derive the custody mandate PDA for this deployment.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="assetDetails.custodianWallet"
                      render={({ field }: { field: any }) => (
                        <FormItem>
                          <FormLabel>Custodian Wallet</FormLabel>
                          <FormControl>
                            <Input placeholder="Custodian wallet address" {...field} />
                          </FormControl>
                          <FormDescription>
                            Must have a registered FID and signs the custody attestation.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ) : null}

                <FormField
                  control={form.control}
                  name="assetDetails.isin"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <FormLabel>ISIN / Identifier</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. US123456789" className="h-11 font-mono" {...field} />
                      </FormControl>
                      <FormDescription>International Securities Identification Number</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="assetDetails.assetType"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Asset Class</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder="Select class" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="real-estate">Real Estate</SelectItem>
                          <SelectItem value="commodity">Commodity</SelectItem>
                          <SelectItem value="equity">Private Equity</SelectItem>
                          <SelectItem value="debt">Fixed Income / Debt</SelectItem>
                          <SelectItem value="art">Collectibles / Art</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="assetDetails.location"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Jurisdiction / Location</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Cayman Islands" className="h-11" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="assetDetails.issuerWallet"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Issuer Wallet (Target Owner)</FormLabel>
                      <FormControl>
                        <Input placeholder="Solana Address" className="h-11 font-mono text-xs" {...field} />
                      </FormControl>
                      <FormDescription>
                        The wallet that will own the deployed token suite.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="assetDetails.description"
                render={({ field }: { field: any }) => (
                  <FormItem>
                    <FormLabel>Asset Prospectus Summary</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Provide a high-level summary of the investment..."
                        className="min-h-[120px] resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </motion.div>
          )}

          {/* Step 2: Valuation */}
          {!isApplicationMode && currentStep === 2 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Valuation & Tokenization
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="assetDetails.underlyingValue"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Underlying Value (USD)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Total value of the underlying asset
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="assetDetails.totalSupply"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Total Tokens</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Total number of tokens to issue
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tokenDetails.initialPrice"
                  render={({ field }: { field: any }) => (
                    <FormItem>
                      <FormLabel>Token Price (USD)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </motion.div>
          )}
          {/* Step 3: Compliance Configuration */}
          {((!isApplicationMode && currentStep === 3) ||
            (isApplicationMode && currentStep === 2)) && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h3 className="text-lg font-bold flex items-center gap-2 text-slate-900">
                <Shield className="h-5 w-5 text-[#172E7F]" />
                {isApplicationMode ? "Compliance Modules" : "Compliance & Trusted Framework"}
              </h3>

              <div className="space-y-6">
                {isApplicationMode ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-5">
                    <h4 className="text-sm font-bold text-slate-900">Compliance Module Request</h4>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Select the compliance modules you want for this asset. The platform admin will configure required identity claims and trusted claim issuers during review.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Claim Topics */}
                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Required Identity Claims</h4>
                    <p className="text-xs text-slate-500">Select the investor credentials required before transfers are allowed.</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {CLAIM_TOPIC_OPTIONS.map((topic) => (
                      <label key={topic.value} className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-4">
                        <Checkbox
                          checked={requiredClaimTopics.includes(topic.value)}
                          onCheckedChange={() => toggleClaimTopic(topic.value)}
                        />
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">
                            {topic.label} <span className="font-mono text-xs text-slate-500">topic {topic.value}</span>
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">{topic.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Trusted Issuers */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Trusted Claim Issuers</h4>
                    <p className="text-xs text-slate-500">
                      Select authorities approved by the platform admin in Personnel.
                    </p>
                  </div>

                  <Select value={trustedIssuerSelection} onValueChange={addTrustedIssuer}>
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder={trustedIssuersLoading ? "Loading approved issuers..." : "Select an approved trusted issuer"} />
                    </SelectTrigger>
                    <SelectContent>
                      {trustedIssuerRecords.map((issuer) => (
                        <SelectItem key={issuer.id} value={issuer.walletAddress}>
                          <span className="flex flex-col text-left">
                            <span className="font-medium">{issuer.authorityName}</span>
                            <span className="font-mono text-xs text-slate-500">
                              {issuer.walletAddress.slice(0, 12)}...{issuer.walletAddress.slice(-8)} · {getAuthorizedTopicLabel(issuer)}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!trustedIssuersLoading && trustedIssuerRecords.length === 0 ? (
                    <p className="text-xs text-amber-700">
                      No approved trusted issuers are available. Add an authority in Personnel first.
                    </p>
                  ) : null}

                  {selectedTrustedIssuers.length === 0 ? (
                    <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                      <Shield className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-500">Select at least one approved issuer for each required claim topic.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedTrustedIssuers.map((issuer, index) => (
                        <div key={issuer.walletAddress} className="rounded-md border border-slate-200 bg-white p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">{issuer.label}</div>
                              <div className="mt-1 break-all font-mono text-xs text-slate-500">{issuer.walletAddress}</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {issuer.topics.map((topic) => (
                                  <span key={topic.toString()} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-[#172E7F]">
                                    {topic.toString() === "1" ? "KYC topic 1" : "AML topic 2"}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                              <div className="text-[10px] font-mono text-slate-400 truncate max-w-[200px]">
                                FID: {issuer.issuerFid || "Pending derivation"}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 shrink-0 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={() => {
                                  const issuers = form.getValues("complianceRequirements.trustedIssuers");
                                  form.setValue("complianceRequirements.trustedIssuers", issuers.filter((_, i) => i !== index), { shouldValidate: true });
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                  </>
                )}

                {/* Compliance Modules */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Compliance Modules</h4>
                    <p className="text-xs text-slate-500">
                      Selected modules are initialized and bound to this token suite.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {COMPLIANCE_MODULES.map((module) => {
                      const moduleId = module.programId.toBase58();
                      const isSelected = selectedComplianceModules.includes(moduleId);

                      return (
                        <div
                          key={module.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            form.setValue(
                              "complianceRequirements.selectedModules",
                              isSelected
                                ? selectedComplianceModules.filter((id) => id !== moduleId)
                                : [...selectedComplianceModules, moduleId],
                            );
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            form.setValue(
                              "complianceRequirements.selectedModules",
                              isSelected
                                ? selectedComplianceModules.filter((id) => id !== moduleId)
                                : [...selectedComplianceModules, moduleId],
                            );
                          }}
                          className={`rounded-2xl border p-4 text-left transition-colors ${
                            isSelected
                              ? "border-blue-400 bg-blue-50"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border ${
                                isSelected
                                  ? "border-blue-600 bg-blue-600 text-white"
                                  : "border-slate-300 bg-white"
                              }`}
                            >
                              {isSelected ? <CheckCircle className="h-3.5 w-3.5" /> : null}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-slate-900">
                                {module.name}
                              </div>
                              <div className="mt-1 text-xs leading-5 text-slate-500">
                                {module.description}
                              </div>
                              {isSelected ? (
                                <div className="mt-3 space-y-2" onClick={(event) => event.stopPropagation()}>
                                  {module.fields.map((field) => {
                                    const value = complianceModuleParams?.[moduleId]?.[field.key] ?? "";
                                    const placeholder =
                                      field.type === "countries"
                                        ? "Add countries"
                                        : field.type === "country_caps"
                                          ? "Add country caps"
                                          : field.type === "timestamp"
                                            ? "0"
                                            : "1000000";
                                    const updateModuleParam = (nextValue: string) => {
                                      const current =
                                        (form.getValues("complianceRequirements.moduleParams") as Record<string, Record<string, unknown>>) ?? {};
                                      form.setValue("complianceRequirements.moduleParams", {
                                        ...current,
                                        [moduleId]: {
                                          ...(current[moduleId] ?? {}),
                                          [field.key]: nextValue,
                                        },
                                      });
                                    };

                                    return (
                                      <div key={field.key} className="space-y-1">
                                        <Label className="text-[10px] uppercase font-bold text-slate-500">
                                          {field.label}
                                        </Label>
                                        {field.type === "countries" ? (
                                          <AllowedCountriesField
                                            value={value}
                                            onChange={updateModuleParam}
                                          />
                                        ) : field.type === "country_caps" ? (
                                          <CountryCapsField
                                            value={value}
                                            onChange={updateModuleParam}
                                          />
                                        ) : (
                                          <Input
                                            value={String(value)}
                                            placeholder={placeholder}
                                            className="h-9 bg-white text-sm"
                                            onChange={(event) => {
                                              updateModuleParam(event.target.value);
                                            }}
                                          />
                                        )}
                                        <p className="text-[11px] leading-4 text-slate-500">
                                          {field.description}
                                        </p>
                                        {field.type === "countries" || field.type === "country_caps" ? (
                                          <p className="rounded-lg bg-white/70 px-2 py-1 font-mono text-[11px] text-slate-500">
                                            Contract value: {String(value) || "Not configured"}
                                          </p>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Final Step: Admin tokenization or issuer legal documents */}
          {((!isApplicationMode && currentStep === 4) ||
            (isApplicationMode && currentStep === 3)) && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h3 className="text-lg font-bold flex items-center gap-2 text-slate-900">
                <FileText className="h-5 w-5 text-[#172E7F]" />
                {isApplicationMode
                  ? "Legal Documents"
                  : "Mint Configuration & Suite Preview"}
              </h3>

              {!isApplicationMode && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 rounded-2xl bg-[#172E7F]/5 border border-[#172E7F]/10 space-y-4">
                  <div className="flex items-center gap-2 text-[#172E7F]">
                    <Rocket className="h-4 w-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">On-Chain Deployment</span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Token-2022 Mint Address</div>
                    <div className="font-mono text-xs text-slate-900 bg-white p-2 rounded border border-slate-200 truncate">
                      {mintKeypair.publicKey.toBase58()}
                    </div>
                    <p className="text-[10px] text-slate-400 italic">This address is deterministically generated for this session.</p>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                  <FormField
                    control={form.control}
                    name="tokenDetails.decimals"
                    render={({ field }: { field: any }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-bold uppercase text-slate-500">Mint Decimals</FormLabel>
                        <Select
                          onValueChange={(value: string) => field.onChange(parseInt(value))}
                          defaultValue={field.value.toString()}
                        >
                          <FormControl>
                            <SelectTrigger className="bg-white">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {[0, 2, 4, 6, 8, 9, 12, 18].map((dec) => (
                              <SelectItem key={dec} value={dec.toString()}>
                                {dec} {dec === 6 ? "(Standard)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tokenDetails.initialPrice"
                    render={({ field }: { field: any }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-bold uppercase text-slate-500">Initial NAV (USD)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" className="bg-white" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              )}

              {/* Document Summary */}
              <div className="p-5 border border-slate-200 rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <FormLabel className="text-sm font-bold text-slate-900">
                      {documentsReadOnly ? "Issuer Legal Docs" : "Prospectus & Legal Docs"}
                    </FormLabel>
                    {documentsReadOnly ? (
                      <p className="mt-1 text-xs text-slate-500">
                        These files were uploaded by the issuer with the tokenization request.
                      </p>
                    ) : null}
                  </div>
                  {!documentsReadOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-[#172E7F]"
                      onClick={() => document.getElementById("document-upload")?.click()}
                    >
                      <Upload className="h-3.5 w-3.5 mr-2" /> Add Files
                    </Button>
                  )}
                </div>

                {!documentsReadOnly && (
                  <Input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="document-upload"
                  />
                )}

                {documentsReadOnly ? (
                  existingDocuments.length === 0 ? (
                    <div className="py-8 text-center bg-slate-50/50 border border-dashed border-slate-200 rounded-xl">
                      <p className="text-xs text-slate-500">
                        No issuer documents are attached to this request.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {existingDocuments.map((document, index) => (
                        <div
                          key={document.path || `${document.name}-${index}`}
                          className="flex flex-col gap-3 p-3 bg-white border border-slate-100 rounded-xl shadow-sm md:flex-row md:items-center md:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                              <FileText className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold text-slate-800">
                                {document.name}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {formatDocumentType(document.documentType)}
                                {document.size ? ` - ${formatFileSize(document.size)}` : ""}
                              </div>
                            </div>
                          </div>
                          {document.publicUrl ? (
                            <a
                              href={document.publicUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-[#172E7F] hover:bg-slate-50"
                            >
                              <ExternalLink className="mr-2 h-3.5 w-3.5" />
                              Open
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )
                ) : uploadedDocuments.length === 0 ? (
                  <div className="py-8 text-center bg-slate-50/50 border border-dashed border-slate-200 rounded-xl">
                    <p className="text-xs text-slate-500">
                      No documents attached. You can add asset documents,
                      ID card, passport, proof of address, or other legal files.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {uploadedDocuments.map((document, index: number) => (
                      <div
                        key={`${document.file.name}-${document.file.lastModified}-${index}`}
                        className="flex flex-col gap-3 p-3 bg-white border border-slate-100 rounded-xl shadow-sm md:flex-row md:items-center md:justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-slate-50 rounded-lg text-slate-400">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="text-xs font-medium text-slate-700 truncate max-w-[250px]">
                            {document.file.name}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={document.documentType}
                            onValueChange={(value) =>
                              updateDocumentType(index, value)
                            }
                          >
                            <SelectTrigger className="h-9 w-full bg-white md:w-56">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DOCUMENT_TYPE_OPTIONS.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0 text-slate-400 hover:text-red-500"
                            onClick={() => removeFile(index)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isApplicationMode && !documentsReadOnly && onUploadDocuments && (
                  <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Upload documents before submitting
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Add files first, upload them to secure storage, then submit
                        the tokenization request.
                      </p>
                      {storedUploadedDocuments.length > 0 ? (
                        <p className="mt-2 text-xs font-semibold text-emerald-700">
                          {storedUploadedDocuments.length} document
                          {storedUploadedDocuments.length === 1 ? "" : "s"} uploaded.
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant={storedUploadedDocuments.length > 0 ? "outline" : "default"}
                      className="h-10 shrink-0"
                      disabled={uploadingDocuments || uploadedDocuments.length === 0}
                      onClick={() => void uploadSelectedDocuments()}
                    >
                      {uploadingDocuments ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : storedUploadedDocuments.length > 0 ? (
                        <>
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Re-upload Documents
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Upload Documents
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {requireDocumentApproval && (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <Checkbox
                      id="issuer-documents-approved"
                      checked={documentsApproved}
                      onCheckedChange={(value) => setDocumentsApproved(value === true)}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor="issuer-documents-approved"
                      className="cursor-pointer text-sm leading-5 text-emerald-900"
                    >
                      I have reviewed the issuer-uploaded legal documents and approve
                      using them for this token deployment.
                    </Label>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between pt-8 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-6 border-slate-200 text-slate-600 hover:bg-slate-50"
              onClick={prevStep}
              disabled={currentStep === 1 || deploying || uploadingDocuments}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>

            {currentStep < finalStep ? (
              <Button
                type="button"
                className="h-11 px-8 bg-gradient-to-r from-[#172E7F] to-[#2A5FA6] text-white hover:shadow-lg transition-all"
                onClick={() => void nextStep()}
                disabled={uploadingDocuments}
              >
                Continue
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                type="submit"
                className="h-11 px-10 bg-gradient-to-r from-[#172E7F] to-[#2A5FA6] text-white hover:shadow-lg transition-all"
                disabled={
                  deploying ||
                  uploadingDocuments ||
                  (!isPlatformAdmin && !isApplicationMode) ||
                  (isApplicationMode &&
                    Boolean(onUploadDocuments) &&
                    storedUploadedDocuments.length === 0)
                }
              >
                {deploying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deploying Suite...
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 h-4 w-4" />
                    {submitLabel || (isApplicationMode ? "Submit Request" : "Deploy Token Suite")}
                  </>
                )}
              </Button>
            )}
          </div>
        </form>
      </Form>
    </motion.div>
  );
}
