declare module "iso-3166-1" {
  export type Country = {
    country: string;
    alpha2: string;
    alpha3: string;
    numeric: string;
  };

  export function all(): Country[];
  export function whereAlpha2(alpha2: string): Country | undefined;
  export function whereAlpha3(alpha3: string): Country | undefined;
  export function whereNumeric(numeric: string | number): Country | undefined;
  export function whereCountry(country: string): Country | undefined;
}
