import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Card, TextField, Button, BlockStack, InlineStack, Checkbox, Text, Select, InlineError } from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { authenticate } from "../shopify.server";
import { listShopifyCountries, listShopifyProvinces } from "../services/countries.server";
import { getMarketCurrencyByCountry, isCountryEnabledInMarkets } from "../services/markets.server";
import { fetchVariantInfos } from "../services/variants.server";
import { fetchDeliveryProfilesForVariants } from "../services/profiles.server";
import prisma from "../db.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const scenario = await prisma.scenario.findUnique({ where: { id: String(params.id) } });
  if (!scenario) throw new Response("Not Found", { status: 404 });
  const [countries, provinces, currency, marketEnabled, variants, profiles] = await Promise.all([
    listShopifyCountries(session.shop).catch(() => []),
    listShopifyProvinces(session.shop, scenario.countryCode).catch(() => []),
    getMarketCurrencyByCountry(session.shop, scenario.countryCode).catch(() => undefined),
    isCountryEnabledInMarkets(session.shop, scenario.countryCode).catch(() => true),
    fetchVariantInfos(session.shop, scenario.productVariantIds || []).catch(() => []),
    fetchDeliveryProfilesForVariants(session.shop, scenario.productVariantIds || []).catch(() => []),
  ]);
  return json({ scenario, countries, provinces, currency, marketEnabled, variants, profiles });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(params.id);
  const intent = String(form.get("intent"));
  if (intent === "save") {
    await prisma.scenario.update({
      where: { id },
      data: {
        name: String(form.get("name")),
        active: form.get("active") === "on",
        countryCode: String(form.get("countryCode")),
        postalCode: String(form.get("postalCode") || ""),
        provinceCode: String(form.get("provinceCode") || ""),
        city: String(form.get("city") || ""),
        discountCode: String(form.get("discountCode") || "") || undefined,
        expectations: {
          freeShippingThreshold: form.get("freeShippingThreshold") ? Number(form.get("freeShippingThreshold")) : undefined,
          min: form.get("minPrice") ? Number(form.get("minPrice")) : undefined,
          max: form.get("maxPrice") ? Number(form.get("maxPrice")) : undefined,
          boundsTarget: String(form.get("boundsTarget") || "CHEAPEST"),
          boundsTitle: String(form.get("boundsTitle") || "") || undefined,
        } as any,
        screenshotEnabled: form.get("screenshotEnabled") === "on",
        includeInPromo: form.get("includeInPromo") === "on",
        alertLevel: (String(form.get("alertLevel")) === "FAIL" ? "FAIL" : "WARN") as any,
        consecutiveFailThreshold: form.get("alertDampen") === "on" ? 2 : undefined,
        notes: String(form.get("notes") || "") || undefined,
      },
    });
    if (String(form.get('runAfterSave')) === '1') {
      // enqueue immediate run
      const shop = await prisma.shop.findFirst({ where: { id: (await prisma.scenario.findUnique({ where: { id } }))!.shopId } });
      if (shop) {
        const { enqueueScenarioRun } = await import("../models/job.server");
        await enqueueScenarioRun(shop.id, id);
      }
    }
    return redirect(`/app/scenarios/${id}`);
  }
  return redirect(`/app/scenarios/${id}`);
};

export default function ScenarioDetail() {
  const { scenario, countries, provinces, currency, marketEnabled, variants, profiles } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const loading = fetcher.state !== 'idle';

  const [countryCode, setCountryCode] = useState<string>(scenario.countryCode);
  const [postalCode, setPostalCode] = useState<string>(scenario.postalCode ?? '');
  const [provinceCode, setProvinceCode] = useState<string>(scenario.provinceCode ?? '');
  const [city, setCity] = useState<string>(scenario.city ?? '');
  const [discountCode, setDiscountCode] = useState<string>(scenario.discountCode ?? '');
  const [screenshotEnabled, setScreenshotEnabled] = useState<boolean>(!!scenario.screenshotEnabled);
  const [includeInPromo, setIncludeInPromo] = useState<boolean>(!!scenario.includeInPromo);
  const [alertLevel, setAlertLevel] = useState<string>(scenario.alertLevel || 'WARN');
  const [freeShip, setFreeShip] = useState<string>(String((scenario.expectations as any)?.freeShippingThreshold ?? ''));
  const [minPrice, setMinPrice] = useState<string>(String((scenario.expectations as any)?.min ?? ''));
  const [maxPrice, setMaxPrice] = useState<string>(String((scenario.expectations as any)?.max ?? ''));
  const [boundsTarget, setBoundsTarget] = useState<string>((scenario.expectations as any)?.boundsTarget || 'CHEAPEST');
  const [boundsTitle, setBoundsTitle] = useState<string>((scenario.expectations as any)?.boundsTitle || '');
  const [notes, setNotes] = useState<string>(scenario.notes ?? '');
  const [alertDampen, setAlertDampen] = useState<boolean>(!!scenario.consecutiveFailThreshold && scenario.consecutiveFailThreshold >= 2);
  const [district, setDistrict] = useState<string>(String((scenario.expectations as any)?.district || ''));

  const [provinceOptions, setProvinceOptions] = useState<{ code: string; name: string }[]>(provinces || []);
  const [marketCurrency, setMarketCurrency] = useState<string | undefined>(currency);
  const [marketEnabledState, setMarketEnabledState] = useState<boolean>(!!marketEnabled);
  const [marketsUrl, setMarketsUrl] = useState<string | undefined>(undefined);
  const [zipStateMismatch, setZipStateMismatch] = useState<boolean>(false);

  useEffect(() => {
    // Fetch market info and provinces when country changes
    (async () => {
      if (!countryCode) return;
      try {
        const [marketRes, provRes] = await Promise.all([
          fetch(`/internal/market-info?countryCode=${encodeURIComponent(countryCode)}`),
          fetch(`/internal/provinces?countryCode=${encodeURIComponent(countryCode)}`),
        ]);
        const marketData = await marketRes.json();
        setMarketCurrency(marketData?.currency);
        setMarketEnabledState(!!marketData?.enabled);
        setMarketsUrl(marketData?.marketsUrl);
        const provData = await provRes.json();
        setProvinceOptions(Array.isArray(provData?.provinces) ? provData.provinces : []);
      } catch {
        setProvinceOptions([]);
      }
    })();
  }, [countryCode]);

  const [lookupProvince, setLookupProvince] = useState<string | undefined>(undefined);
  const [lookupCity, setLookupCity] = useState<string | undefined>(undefined);

  useEffect(() => {
    const data: any = fetcher.data;
    if (data && (data.city || data.provinceCode)) {
      if (data.city) {
        setCity(data.city);
        setLookupCity(data.city);
      }
      if (data.provinceCode) {
        setProvinceCode(data.provinceCode);
        setLookupProvince(data.provinceCode);
      }
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (lookupProvince && provinceCode) {
      setZipStateMismatch(lookupProvince !== provinceCode);
    } else {
      setZipStateMismatch(false);
    }
  }, [lookupProvince, provinceCode]);

  const estimatedSubtotal = useMemo(() => {
    const pairs = (scenario.productVariantIds || []).map((id: string, idx: number) => ({
      qty: scenario.quantities[idx] || 1,
      variant: variants.find((v: any) => v.id === id),
    }));
    const sum = pairs.reduce((acc: number, p) => acc + ((p.variant?.priceAmount || 0) * p.qty), 0);
    return isNaN(sum) ? 0 : sum;
  }, [variants, scenario.productVariantIds, scenario.quantities]);
  return (
    <Page title="Scenario">
      <BlockStack gap="400">
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save" />
            <BlockStack gap="200">
              <TextField label="Name" name="name" defaultValue={scenario.name} autoComplete="off" />
              <Checkbox label="Active" name="active" defaultChecked={scenario.active} />
              <InlineStack gap="400">
                <Select label="Country" name="countryCode" options={countries} value={countryCode} onChange={(v) => { setCountryCode(String(v)); setPostalCode(''); setProvinceCode(''); setCity(''); setDistrict(''); setLookupProvince(undefined); setLookupCity(undefined); setZipStateMismatch(false); }} />
                {(() => {
                  const isHK = countryCode === 'HK';
                  const isAE = countryCode === 'AE';
                  const showPostal = !(isHK || isAE);
                  if (!showPostal) return null;
                  return (
                    <TextField label="Postal code" name="postalCode" value={postalCode} onChange={setPostalCode} helpText="We’ll auto-fill city/state when possible." onBlur={() => {
                      if (postalCode && countryCode) {
                        const url = `/internal/address-lookup?countryCode=${encodeURIComponent(countryCode)}&postalCode=${encodeURIComponent(postalCode)}`;
                        fetcher.load(url);
                      }
                    }} />
                  );
                })()}
                {(() => {
                  const isHK = countryCode === 'HK';
                  const isAE = countryCode === 'AE';
                  const provinceLabel = isHK ? 'Region' : isAE ? 'Emirate' : 'State/Province';
                  const showProvince = isHK || isAE || provinceOptions.length > 0;
                  if (!showProvince) return null;
                  return provinceOptions.length > 0 ? (
                    <Select label={provinceLabel} name="provinceCode" options={provinceOptions.map(s => ({ label: s.name, value: s.code }))} value={provinceCode} onChange={(v) => setProvinceCode(String(v))} />
                  ) : (
                    <TextField label={provinceLabel} name="provinceCode" value={provinceCode} onChange={setProvinceCode} />
                  );
                })()}
                <TextField label={'City'} name="city" value={city} onChange={setCity} />
                {countryCode === 'TR' ? (
                  <TextField label="District (ilçe)" name="district" value={district} onChange={setDistrict} />
                ) : null}
              </InlineStack>
              <InlineStack gap="200">
                <Text tone={marketEnabledState ? 'success' : 'critical'} variant="bodySm" as="p">{marketEnabledState ? '✅ Market enabled' : '❌ Not enabled in Shopify Markets'}</Text>
                {marketsUrl ? (
                  <Button url={marketsUrl} variant="plain">Manage Markets</Button>
                ) : null}
              </InlineStack>
              {zipStateMismatch ? (
                <Text tone="warning" variant="bodySm" as="p">Postal code and State appear to mismatch; double-check destination.</Text>
              ) : null}
              <InlineStack>
                <Button variant="plain" onClick={async () => {
                  if (!countryCode) return;
                  const res = await fetch(`/internal/test-address?countryCode=${encodeURIComponent(countryCode)}`);
                  const data = await res.json();
                  if (data?.postalCode) setPostalCode(data.postalCode);
                  if (data?.provinceCode) setProvinceCode(data.provinceCode);
                  if (data?.city) setCity((prev) => prev || data.city);
                }}>Use default test address</Button>
              </InlineStack>
              <InlineStack gap="400">
                <TextField label="Discount code" name="discountCode" value={discountCode} onChange={setDiscountCode} autoComplete="off" />
                <Checkbox label="Screenshot proof" name="screenshotEnabled" checked={!!screenshotEnabled} onChange={(_, v) => setScreenshotEnabled(v)} helpText="Takes a shipping-step screenshot; slightly slower, great for support." />
                <Checkbox label="Run hourly during promo mode" name="includeInPromo" checked={!!includeInPromo} onChange={(_, v) => setIncludeInPromo(v)} helpText="When promo mode is on, this scenario runs hourly." />
              </InlineStack>
              <InlineStack gap="400">
                <Select
                  label="Alert level"
                  name="alertLevel"
                  options={[{label: 'Warn', value: 'WARN'}, {label: 'Fail', value: 'FAIL'}]}
                  onChange={(v) => setAlertLevel(String(v))}
                  value={alertLevel}
                />
              </InlineStack>
              <InlineStack gap="400">
                <TextField label={`Free shipping threshold (${marketCurrency || ''})`} name="freeShippingThreshold" type="number" value={freeShip} onChange={setFreeShip} />
                <TextField label={`Expected price min (${marketCurrency || ''})`} name="minPrice" type="number" value={minPrice} onChange={setMinPrice} />
                <TextField label={`Expected price max (${marketCurrency || ''})`} name="maxPrice" type="number" value={maxPrice} onChange={setMaxPrice} />
              </InlineStack>
              <InlineStack gap="400">
                <Select
                  label="Apply bounds to"
                  name="boundsTarget"
                  options={[{ label: 'Cheapest rate', value: 'CHEAPEST' }, { label: 'Rate title contains…', value: 'TITLE' }]}
                  value={boundsTarget}
                  onChange={(v) => setBoundsTarget(String(v))}
                />
                {boundsTarget === 'TITLE' ? (
                  <TextField label="Title contains" name="boundsTitle" value={boundsTitle} onChange={setBoundsTitle} placeholder="Standard, Ground, Economy" />
                ) : null}
              </InlineStack>
              <InlineStack>
                <Checkbox label="Only alert after 2 consecutive fails" name="alertDampen" checked={alertDampen} onChange={(_, v) => setAlertDampen(v)} />
              </InlineStack>
              <TextField label="Notes" name="notes" defaultValue={scenario.notes ?? ''} autoComplete="off" multiline={3} />
              <InlineStack gap="400">
                <Button submit variant="primary">Save</Button>
                <Button submit disabled={(() => {
                  const hasItems = (scenario.productVariantIds || []).length > 0;
                  const isHK = countryCode === 'HK';
                  const isAE = countryCode === 'AE';
                  const showProvince = isHK || isAE || provinceOptions.length > 0;
                  const needsProvince = showProvince && provinceOptions.length > 0; // required only when Shopify provides provinces
                  const needsCity = false; // optional
                  const postalOk = true; // always optional
                  const provinceOk = needsProvince ? !!provinceCode : true;
                  const cityOk = needsCity ? !!city : true;
                  return !(hasItems && postalOk && provinceOk && cityOk) || zipStateMismatch;
                })()} onClick={() => {
                  const form = document.querySelector('form') as HTMLFormElement;
                  const hidden = document.createElement('input');
                  hidden.type = 'hidden';
                  hidden.name = 'runAfterSave';
                  hidden.value = '1';
                  form.appendChild(hidden);
                }}>Save & Run now</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>
        <Card>
          <Text as="h3" variant="headingMd">Cart items</Text>
          <Text variant="bodyMd" as="p">Manage variant IDs and quantities.</Text>
          {Array.isArray(variants) && variants.length > 0 ? (
            <BlockStack gap="100">
              <Text variant="bodySm" as="p">Summary:</Text>
              <InlineStack gap="200">
                {variants.map((v, idx) => (
                  <span key={v.id} style={{ border: '1px solid var(--p-color-border)', borderRadius: 12, padding: '2px 8px' }}>
                    {v.productTitle} {v.title ? `(${v.title})` : ''} ×{scenario.quantities[idx] || 1} {v.grams ? `(${v.grams >= 1000 ? (v.grams/1000).toFixed(1)+' kg' : v.grams+' g'})` : ''}
                  </span>
                ))}
              </InlineStack>
              {Array.isArray(profiles) && profiles.length > 0 ? (
                <Text variant="bodySm" as="p">Profiles covered: {profiles.join(', ')}</Text>
              ) : null}
              {variants.some(v => !v.requiresShipping || (v.grams ?? 0) === 0) ? (
                <Text tone="warning" variant="bodySm" as="p">Some items are non-shippable or have 0 weight; rates may be missing.</Text>
              ) : null}
              {Number(freeShip || '0') > 0 && estimatedSubtotal > 0 && estimatedSubtotal < Number(freeShip) ? (
                <Text tone="warning" variant="bodySm" as="p">This cart is below the threshold; free-shipping won’t be validated.</Text>
              ) : null}
            </BlockStack>
          ) : null}
          <InlineStack>
            <Button url={`/app/scenarios/${scenario.id}/items`}>
              Edit items
            </Button>
          </InlineStack>
        </Card>
      </BlockStack>
    </Page>
  );
}


