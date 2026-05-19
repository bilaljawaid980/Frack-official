import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { PublicKey } from "@solana/web3.js";

// ─── Tailwind / CSS Helpers ───────────────────────────────────────────────────

/**
 * Merge Tailwind class names, resolving conflicts with tailwind-merge.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── Address Formatting ───────────────────────────────────────────────────────

/**
 * Shortens a base-58 public key to "XXXX...XXXX" format.
 *
 * @param address - Public key string or PublicKey instance
 * @param chars   - Number of characters to show on each side (default 4)
 */
export function shortenAddress(
  address: string | PublicKey,
  chars = 4
): string {
  const str =
    typeof address === "string" ? address : address.toBase58();
  if (str.length <= chars * 2 + 3) return str;
  return `${str.slice(0, chars)}...${str.slice(-chars)}`;
}

// ─── Token Amount Formatting ──────────────────────────────────────────────────

/**
 * Converts a raw token amount (in base units) to a decimal display string.
 * Uses locale-aware formatting with the correct number of decimal places.
 *
 * @param amount   - Raw amount as bigint or number
 * @param decimals - Token decimal places
 */
export function formatTokenAmount(
  amount: bigint | number,
  decimals: number
): string {
  const raw = typeof amount === "number" ? BigInt(Math.floor(amount)) : amount;
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;

  const fractionStr = fraction.toString().padStart(decimals, "0");
  const trimmed = fractionStr.replace(/0+$/, "");

  const intFormatted = new Intl.NumberFormat("en-US").format(whole);

  return trimmed.length > 0
    ? `${intFormatted}.${trimmed}`
    : intFormatted;
}

/**
 * Formats a number or string as a USD currency string.
 *
 * @param value - Amount to format
 */
export function formatCurrency(
  value: number | string,
  currency = "USD",
  locale = "en-US",
): string {
  const amount = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(amount)) return "$0.00";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}

/**
 * Formats a number as a percentage string (e.g., 0.05 -> "5.00%").
 *
 * @param value - Percentage as a fraction or number
 */
export function formatPercentage(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Parses a human-readable decimal amount string into a bigint base-unit value.
 * Throws if the string is not a valid positive decimal number.
 *
 * @param amount   - Decimal string (e.g. "1.5")
 * @param decimals - Token decimal places
 */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid token amount: "${amount}"`);
  }

  const [wholePart, fracPart = ""] = trimmed.split(".");
  const paddedFrac = fracPart.slice(0, decimals).padEnd(decimals, "0");

  return BigInt(wholePart) * BigInt(10 ** decimals) + BigInt(paddedFrac);
}

// ─── Date / Time ──────────────────────────────────────────────────────────────

/**
 * Formats a Unix timestamp (seconds) into a locale date-time string.
 *
 * @param ts - Unix timestamp in seconds
 */
export function formatUnixTimestamp(ts: number): string {
  if (!ts || ts === 0) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ts * 1000));
}

/**
 * Formats a date-like value into a compact locale date string.
 */
export function formatDate(
  value: Date | string | number | null | undefined,
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Returns true if the string is a valid Solana base-58 public key.
 */
export function isValidPublicKey(key: string): boolean {
  try {
    new PublicKey(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Alias for isValidPublicKey.
 */
export const validateSolanaAddress = isValidPublicKey;

// ─── Async Utilities ──────────────────────────────────────────────────────────

/**
 * Pauses execution for the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an async function with exponential back-off.
 *
 * @param fn      - Async function to retry
 * @param retries - Maximum number of attempts (default 3)
 * @param delay   - Initial delay in ms (doubles on each retry, default 500)
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 500
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await sleep(delay * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

// ─── SOL Conversions ──────────────────────────────────────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Converts lamports to SOL as a floating-point number.
 */
export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Converts SOL to lamports as an integer number.
 */
export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

/**
 * Copies text to the system clipboard.
 * Returns true on success, false if the clipboard API is unavailable or fails.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (
    typeof window !== "undefined" &&
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // Fallback for older browsers
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

// ─── Cryptography ─────────────────────────────────────────────────────────────

/**
 * Generates 32 cryptographically random bytes, suitable for use as a PDA salt.
 */
export function generateSalt(): Uint8Array {
  const buf = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buf);
    return buf;
  }
  throw new Error("Secure random generation is unavailable in this runtime.");
}

// ─── Country Codes (ISO 3166-1 numeric) ──────────────────────────────────────

const COUNTRY_CODES: Record<number, string> = {
  4: "Afghanistan",
  8: "Albania",
  12: "Algeria",
  20: "Andorra",
  24: "Angola",
  32: "Argentina",
  36: "Australia",
  40: "Austria",
  50: "Bangladesh",
  56: "Belgium",
  68: "Bolivia",
  76: "Brazil",
  100: "Bulgaria",
  116: "Cambodia",
  124: "Canada",
  152: "Chile",
  156: "China",
  170: "Colombia",
  191: "Croatia",
  196: "Cyprus",
  203: "Czech Republic",
  208: "Denmark",
  214: "Dominican Republic",
  218: "Ecuador",
  818: "Egypt",
  222: "El Salvador",
  233: "Estonia",
  246: "Finland",
  250: "France",
  276: "Germany",
  288: "Ghana",
  300: "Greece",
  320: "Guatemala",
  344: "Hong Kong",
  348: "Hungary",
  356: "India",
  360: "Indonesia",
  364: "Iran",
  368: "Iraq",
  372: "Ireland",
  376: "Israel",
  380: "Italy",
  388: "Jamaica",
  392: "Japan",
  400: "Jordan",
  398: "Kazakhstan",
  404: "Kenya",
  410: "South Korea",
  414: "Kuwait",
  428: "Latvia",
  440: "Lithuania",
  442: "Luxembourg",
  458: "Malaysia",
  484: "Mexico",
  504: "Morocco",
  528: "Netherlands",
  554: "New Zealand",
  566: "Nigeria",
  578: "Norway",
  586: "Pakistan",
  591: "Panama",
  604: "Peru",
  608: "Philippines",
  616: "Poland",
  620: "Portugal",
  630: "Puerto Rico",
  634: "Qatar",
  642: "Romania",
  643: "Russia",
  682: "Saudi Arabia",
  688: "Serbia",
  702: "Singapore",
  703: "Slovakia",
  705: "Slovenia",
  710: "South Africa",
  724: "Spain",
  144: "Sri Lanka",
  752: "Sweden",
  756: "Switzerland",
  158: "Taiwan",
  764: "Thailand",
  792: "Turkey",
  784: "United Arab Emirates",
  826: "United Kingdom",
  840: "United States",
  858: "Uruguay",
  860: "Uzbekistan",
  862: "Venezuela",
  704: "Vietnam",
  887: "Yemen",
  716: "Zimbabwe",
};

/**
 * Returns the country name for an ISO 3166-1 numeric country code.
 * Returns "Unknown Country (code)" if the code is not in the table.
 *
 * @param code - ISO 3166-1 numeric code
 */
export function getCountryName(code: number): string {
  return COUNTRY_CODES[code] ?? `Unknown Country (${code})`;
}

/**
 * Returns all known countries as {code, name} pairs sorted by name.
 */
export function getAllCountries(): Array<{ code: number; name: string }> {
  return Object.entries(COUNTRY_CODES)
    .map(([code, name]) => ({ code: Number(code), name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
