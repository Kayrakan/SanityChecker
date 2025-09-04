export type TestAddress = { countryCode: string; postalCode?: string; provinceCode?: string };

const DEFAULTS: Record<string, TestAddress> = {
  US: { countryCode: "US", postalCode: "94107", provinceCode: "CA" },
  GB: { countryCode: "GB", postalCode: "SW1A 1AA" },
  DE: { countryCode: "DE", postalCode: "10115" },
  CA: { countryCode: "CA", postalCode: "M5V 2T6", provinceCode: "ON" },
  FR: { countryCode: "FR", postalCode: "75001" },
  AU: { countryCode: "AU", postalCode: "2000", provinceCode: "NSW" },
  TR: { countryCode: "TR", postalCode: "34010" },
};

export function getTestAddress(countryCode: string): TestAddress {
  const code = countryCode.toUpperCase();
  return DEFAULTS[code] ?? { countryCode: code };
}

export function defaultCountries(): string[] {
  return ["US", "GB", "DE"];
}


