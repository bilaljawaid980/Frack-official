"use client";

import * as ISO3166 from "iso-3166-1";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type IsoCountryRecord = {
  country?: string;
  name?: string;
  alpha2?: string;
  alpha3?: string;
  numeric?: string | number;
};

type CountryOption = {
  alpha2: string;
  name: string;
  numeric: number;
};

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

const COUNTRY_BY_NUMERIC = new Map(COUNTRY_OPTIONS.map((country) => [country.numeric, country]));

function CountrySelectValue({ country }: { country?: CountryOption }) {
  if (!country) return <SelectValue placeholder="Select country" />;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <CountryFlag country={country} />
      <span className="truncate">{country.name}</span>
      <span className="shrink-0 text-xs text-slate-500">{country.numeric}</span>
    </span>
  );
}

export function CountryCodeSelect({
  id,
  value,
  onValueChange,
  disabled,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selectedCountry = COUNTRY_BY_NUMERIC.get(Number(value));

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className="bg-white">
        <CountrySelectValue country={selectedCountry} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectGroup>
          {COUNTRY_OPTIONS.map((country) => (
            <SelectItem key={country.numeric} value={String(country.numeric)}>
              <span className="flex min-w-0 items-center gap-2">
                <CountryFlag country={country} />
                <span className="truncate">{country.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{country.numeric}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
