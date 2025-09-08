import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useFetcher, Outlet, useLocation } from "@remix-run/react";
import { useNavigate } from "@remix-run/react";
import { Page, Card, TextField, Button, BlockStack, InlineStack, Checkbox, Text, Select, InlineError, Modal, Spinner } from "@shopify/polaris";
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
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop || scenario.shopId !== shop.id) throw new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const isNew = url.searchParams.get('new') === '1';
  const [countries, provinces, currency, marketEnabled, variants, profiles] = await Promise.all([
    listShopifyCountries(session.shop).catch(() => []),
    listShopifyProvinces(session.shop, scenario.countryCode).catch(() => []),
    getMarketCurrencyByCountry(session.shop, scenario.countryCode).catch(() => undefined),
    isCountryEnabledInMarkets(session.shop, scenario.countryCode).catch(() => true),
    fetchVariantInfos(session.shop, scenario.productVariantIds || []).catch(() => []),
    fetchDeliveryProfilesForVariants(session.shop, scenario.productVariantIds || []).catch(() => []),
  ]);
  return json({ scenario, countries, provinces, currency, marketEnabled, variants, profiles, isNew });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const isTruthy = (value: FormDataEntryValue | null) => {
    if (value == null) return false;
    const normalized = String(value).toLowerCase();
    return normalized === "on" || normalized === "true" || normalized === "1" || normalized === "yes";
  };
  const getBoolean = (name: string) => {
    const values = form.getAll(name);
    if (!values || values.length === 0) return false;
    return isTruthy(values[values.length - 1] ?? null);
  };
  const id = String(params.id);
  const intent = String(form.get("intent"));
  // ownership guard
  const scenario = await prisma.scenario.findUnique({ where: { id } });
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!scenario || !shop || scenario.shopId !== shop.id) {
    throw new Response("Forbidden", { status: 403 });
  }
  if (intent === "delete") {
    await prisma.scenario.delete({ where: { id } });
    return redirect(`/app/scenarios`);
  }
  if (intent === "save") {
    await prisma.scenario.update({
      where: { id },
      data: ({
        name: String(form.get("name")),
        active: getBoolean("active"),
        countryCode: String(form.get("countryCode")),
        postalCode: String(form.get("postalCode") || ""),
        provinceCode: String(form.get("provinceCode") || ""),
        city: String(form.get("city") || ""),
        firstName: String(form.get("firstName") || ""),
        lastName: String(form.get("lastName") || ""),
        company: String(form.get("company") || ""),
        address1: String(form.get("address1") || ""),
        address2: String(form.get("address2") || ""),
        phone: String(form.get("phone") || ""),
        discountCode: String(form.get("discountCode") || "") || undefined,
        expectations: (() => {
          const exp: any = {
            freeShippingThreshold: form.get("freeShippingThreshold") ? Number(form.get("freeShippingThreshold")) : undefined,
            min: form.get("minPrice") ? Number(form.get("minPrice")) : undefined,
            max: form.get("maxPrice") ? Number(form.get("maxPrice")) : undefined,
            boundsTarget: String(form.get("boundsTarget") || "CHEAPEST"),
            boundsTitle: String(form.get("boundsTitle") || "") || undefined,
            district: String(form.get("district") || "") || undefined,
          };
          return Object.fromEntries(Object.entries(exp).filter(([_, v]) => v !== undefined && v !== ""));
        })() as any,
        screenshotEnabled: getBoolean("screenshotEnabled"),
        includeInPromo: getBoolean("includeInPromo"),
        alertLevel: (String(form.get("alertLevel")) === "FAIL" ? "FAIL" : "WARN") as any,
        consecutiveFailThreshold: getBoolean("alertDampen") ? 2 : null,
        notes: String(form.get("notes") || "") || undefined,
      }) as any,
    });
    if (String(form.get('runAfterSave')) === '1') {
      // enqueue immediate run
      const shop = await prisma.shop.findFirst({ where: { id: (await prisma.scenario.findUnique({ where: { id } }))!.shopId } });
      if (shop) {
        const { enqueueScenarioRunBull } = await import("../services/queue-bull.server");
        await enqueueScenarioRunBull(shop.id, id);
      }
    }
    return redirect(`/app/scenarios/${id}`);
  }
  return redirect(`/app/scenarios/${id}`);
};

export default function ScenarioDetail() {
  const { scenario, countries, provinces, currency, marketEnabled, variants, profiles, isNew } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const loading = fetcher.state !== 'idle';
  const navigate = useNavigate();
  const location = useLocation();
  const editingItems = location.pathname.endsWith('/items');
  const showModal = editingItems && new URLSearchParams(location.search).get('modal') === '1';

  const [countryCode, setCountryCode] = useState<string>(scenario.countryCode);
  const [name, setName] = useState<string>(scenario.name || '');
  const [postalCode, setPostalCode] = useState<string>(scenario.postalCode ?? '');
  const [provinceCode, setProvinceCode] = useState<string>(scenario.provinceCode ?? '');
  const [city, setCity] = useState<string>(scenario.city ?? '');
  const [firstName, setFirstName] = useState<string>(String((scenario as any).firstName ?? ''));
  const [lastName, setLastName] = useState<string>(String((scenario as any).lastName ?? ''));
  const [company, setCompany] = useState<string>(String((scenario as any).company ?? ''));
  const [address1, setAddress1] = useState<string>(String((scenario as any).address1 ?? ''));
  const [address2, setAddress2] = useState<string>(String((scenario as any).address2 ?? ''));
  const [phone, setPhone] = useState<string>(String((scenario as any).phone ?? ''));
  const [discountCode, setDiscountCode] = useState<string>(scenario.discountCode ?? '');
  const [active, setActive] = useState<boolean>(!!scenario.active);
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
  // Removed Turkey-specific district input to better align with Shopify Checkout

  const [provinceOptions, setProvinceOptions] = useState<{ code: string; name: string }[]>(Array.isArray(provinces) ? (provinces as any[]).filter(Boolean) : []);
  const [marketCurrency, setMarketCurrency] = useState<string | undefined>(currency);
  const [marketEnabledState, setMarketEnabledState] = useState<boolean>(!!marketEnabled);
  const [marketsUrl, setMarketsUrl] = useState<string | undefined>(undefined);
  const [zipStateMismatch, setZipStateMismatch] = useState<boolean>(false);
  // Dynamic country metadata fetched via internal endpoint

  const [countryMeta, setCountryMeta] = useState<any | null>(null);
  const [countryLoadingCount, setCountryLoadingCount] = useState<number>(0);
  const countryLoading = countryLoadingCount > 0;
  useEffect(() => {
    if (!countryCode) return;
    const controller = new AbortController();
    const debounce = setTimeout(async () => {
      setCountryLoadingCount((c) => c + 1);
      try {
        const res = await fetch(`/internal/country-meta?countryCode=${encodeURIComponent(countryCode)}`, { signal: controller.signal });
        const json = await res.json();
        setCountryMeta(json || null);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setCountryMeta(null);
      } finally {
        setCountryLoadingCount((c) => Math.max(0, c - 1));
      }
    }, 150);
    return () => { clearTimeout(debounce); controller.abort(); };
  }, [countryCode]);

  useEffect(() => {
    // Fetch market info and provinces when country changes
    if (!countryCode) return;
    const ctrlMarket = new AbortController();
    const ctrlProv = new AbortController();
    const debounce = setTimeout(async () => {
      setCountryLoadingCount((c) => c + 1);
      try {
        const [marketRes, provRes] = await Promise.all([
          fetch(`/internal/market-info?countryCode=${encodeURIComponent(countryCode)}`, { signal: ctrlMarket.signal }),
          fetch(`/internal/provinces?countryCode=${encodeURIComponent(countryCode)}`, { signal: ctrlProv.signal }),
        ]);
        const marketData = await marketRes.json();
        setMarketCurrency(marketData?.currency);
        setMarketEnabledState(!!marketData?.enabled);
        setMarketsUrl(marketData?.marketsUrl);
        const provData = await provRes.json();
        setProvinceOptions(Array.isArray(provData?.provinces) ? provData.provinces : []);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setProvinceOptions([]);
      } finally {
        setCountryLoadingCount((c) => Math.max(0, c - 1));
      }
    }, 150);
    return () => { clearTimeout(debounce); ctrlMarket.abort(); ctrlProv.abort(); };
  }, [countryCode]);

  const [lookupProvince, setLookupProvince] = useState<string | undefined>(undefined);
  const [lookupCity, setLookupCity] = useState<string | undefined>(undefined);

  // Helper: build label with '*' when Shopify marks the field required
  const labelWithStar = (key: string, fallback: string): string => {
    const base = String((countryMeta?.labels?.[key] || (key === 'provinceCode' ? countryMeta?.provinceLabel : countryMeta?.cityLabel) || fallback) || fallback);
    return `${base}${countryMeta?.required?.[key] ? ' *' : ''}`;
  };

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

  // Keep local form state in sync with latest loader data after save/navigation
  useEffect(() => {
    setCountryCode(String(scenario.countryCode));
    setName(String(scenario.name || ''));
    setPostalCode(String(scenario.postalCode ?? ''));
    setProvinceCode(String(scenario.provinceCode ?? ''));
    setCity(String(scenario.city ?? ''));
    setFirstName(String((scenario as any).firstName ?? ''));
    setLastName(String((scenario as any).lastName ?? ''));
    setCompany(String((scenario as any).company ?? ''));
    setAddress1(String((scenario as any).address1 ?? ''));
    setAddress2(String((scenario as any).address2 ?? ''));
    setPhone(String((scenario as any).phone ?? ''));
    setDiscountCode(String(scenario.discountCode ?? ''));
    setActive(!!scenario.active);
    setScreenshotEnabled(!!scenario.screenshotEnabled);
    setIncludeInPromo(!!scenario.includeInPromo);
    setAlertLevel(String(scenario.alertLevel || 'WARN'));
    setFreeShip(String((scenario.expectations as any)?.freeShippingThreshold ?? ''));
    setMinPrice(String((scenario.expectations as any)?.min ?? ''));
    setMaxPrice(String((scenario.expectations as any)?.max ?? ''));
    setBoundsTarget(String((scenario.expectations as any)?.boundsTarget || 'CHEAPEST'));
    setBoundsTitle(String((scenario.expectations as any)?.boundsTitle || ''));
    setNotes(String(scenario.notes ?? ''));
    setAlertDampen(!!scenario.consecutiveFailThreshold && scenario.consecutiveFailThreshold >= 2);
  }, [scenario]);

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
      {(countryLoading || loading) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }} aria-busy>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 24, borderRadius: 8, background: 'rgba(255,255,255,0.9)', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
            <Spinner accessibilityLabel="Updating scenario" size="large" />
            <Text as="span" variant="bodySm" tone="subdued">Updating…</Text>
          </div>
        </div>
      )}
      {showModal ? (
        <Modal
          open
          onClose={() => navigate(`/app/scenarios/${scenario.id}`)}
          title="Edit items"
          size="large"
        >
          <Modal.Section>
            <Outlet />
          </Modal.Section>
        </Modal>
      ) : editingItems ? (
        <Outlet />
      ) : (
      <BlockStack gap="400">
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save" />
            <BlockStack gap="200">
              <TextField label="Name" name="name" value={name} onChange={setName} autoComplete="off" />
              {/* Hidden fallback so unchecked state still submits */}
              <input type="hidden" name="active" value="0" />
              <Checkbox label="Active" name="active" value="1" checked={active} onChange={(checked) => setActive(!!checked)} />
              <InlineStack gap="400">
                <Select label="Country" name="countryCode" options={(Array.isArray(countries) ? (countries as any[]).map((c: any) => ({ label: c.label, value: c.value })) : [])} value={countryCode} onChange={(v) => { setCountryCode(String(v)); setPostalCode(''); setProvinceCode(''); setCity(''); setLookupProvince(undefined); setLookupCity(undefined); setZipStateMismatch(false); }} />
              </InlineStack>
              {/* Additional country-specific fields rendered dynamically following checkout order */}
              {Array.isArray(countryMeta?.orderedFields) ? (
                <BlockStack gap="200">
                  {countryMeta.orderedFields.map((group: string[], gi: number) => (
                    <InlineStack gap="400" key={`g-${gi}`}>
                      {group.map((field: string, idx: number) => {
                        if (field === 'countryCode') return null;
                        if (field === 'firstName') return (
                          <TextField key={`f-${gi}-${idx}`} label={labelWithStar('firstName', 'First name')} name="firstName" autoComplete="off" value={firstName} onChange={setFirstName} />
                        );
                        if (field === 'lastName') return (
                          <TextField key={`f-${gi}-${idx}`} label={labelWithStar('lastName', 'Last name')} name="lastName" autoComplete="off" value={lastName} onChange={setLastName} />
                        );
                        if (field === 'company') return (
                          <TextField key={`f-${gi}-${idx}`} label={labelWithStar('company', 'Company')} name="company" autoComplete="off" value={company} onChange={setCompany} />
                        );
                        if (field === 'address1') return (
                          <TextField key={`f-${gi}-${idx}`} label={labelWithStar('address1', 'Address')} name="address1" autoComplete="off" value={address1} onChange={setAddress1} />
                        );
                        if (field === 'address2') return (
                          <TextField key={`f-${gi}-${idx}`} label={labelWithStar('address2', 'Apartment, suite, etc.')} name="address2" autoComplete="off" value={address2} onChange={setAddress2} />
                        );
                        if (field === 'phone') return (
                          <TextField key={`f-${gi}-${idx}`} label={labelWithStar('phone', 'Phone')} name="phone" autoComplete="off" value={phone} onChange={setPhone} />
                        );
                        if (field === 'city') return (
                          <TextField key={`f-${gi}-${idx}`} label={labelWithStar('city', 'City')} name="city" autoComplete="off" value={city} onChange={setCity} />
                        );
                        if (field === 'provinceCode') return (
                          (Array.isArray(countryMeta?.provinces) && countryMeta.provinces.length > 0) ? (
                            <Select key={`f-${gi}-${idx}`} label={labelWithStar('provinceCode', 'State/Province')} name="provinceCode" options={countryMeta.provinces.map((s: any) => ({ label: s.name, value: s.code }))} value={provinceCode} onChange={(v) => setProvinceCode(String(v))} />
                          ) : (
                            <TextField key={`f-${gi}-${idx}`} label={labelWithStar('provinceCode', 'State/Province')} name="provinceCode" autoComplete="off" value={provinceCode} onChange={setProvinceCode} />
                          )
                        );
                        if (field === 'postalCode') return (
                          <TextField key={`f-${gi}-${idx}`} label={labelWithStar('postalCode', 'Postal code')} name="postalCode" autoComplete="off" value={postalCode} onChange={setPostalCode} helpText="We’ll auto-fill city/state when possible." onBlur={() => {
                            if (postalCode && countryCode) {
                              const url = `/internal/address-lookup?countryCode=${encodeURIComponent(countryCode)}&postalCode=${encodeURIComponent(postalCode)}`;
                              fetcher.load(url);
                            }
                          }} />
                        );
                        if (field === 'firstName,lastName') return null;
                        return null;
                      })}
                    </InlineStack>
                  ))}
                </BlockStack>
              ) : null}
              <InlineStack gap="200">
                <Text tone={marketEnabledState ? 'success' : 'critical'} variant="bodySm" as="p">{marketEnabledState ? '✅ Market enabled' : '❌ Not enabled in Shopify Markets'}</Text>
                {marketsUrl ? (
                  <Button url={marketsUrl} variant="plain">Manage Markets</Button>
                ) : null}
              </InlineStack>
              {zipStateMismatch ? (
                <Text tone="caution" variant="bodySm" as="p">Postal code and State appear to mismatch; double-check destination.</Text>
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
                <input type="hidden" name="screenshotEnabled" value="0" />
                <Checkbox label="Screenshot proof" name="screenshotEnabled" value="1" checked={!!screenshotEnabled} onChange={(checked) => setScreenshotEnabled(!!checked)} helpText="Takes a shipping-step screenshot; slightly slower, great for support." />
                <input type="hidden" name="includeInPromo" value="0" />
                <Checkbox label="Run hourly during promo mode" name="includeInPromo" value="1" checked={!!includeInPromo} onChange={(checked) => setIncludeInPromo(!!checked)} helpText="When promo mode is on, this scenario runs hourly." />
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
                <TextField label={`Free shipping threshold (${marketCurrency || ''})`} name="freeShippingThreshold" autoComplete="off" type="number" value={freeShip} onChange={setFreeShip} />
                <TextField label={`Expected price min (${marketCurrency || ''})`} name="minPrice" autoComplete="off" type="number" value={minPrice} onChange={setMinPrice} />
                <TextField label={`Expected price max (${marketCurrency || ''})`} name="maxPrice" autoComplete="off" type="number" value={maxPrice} onChange={setMaxPrice} />
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
                  <TextField label="Title contains" name="boundsTitle" autoComplete="off" value={boundsTitle} onChange={setBoundsTitle} placeholder="Standard, Ground, Economy" />
                ) : null}
              </InlineStack>
              <InlineStack>
                <input type="hidden" name="alertDampen" value="0" />
                <Checkbox label="Only alert after 2 consecutive fails" name="alertDampen" value="1" checked={alertDampen} onChange={(checked) => setAlertDampen(!!checked)} />
              </InlineStack>
              <TextField label="Notes" name="notes" value={notes} onChange={setNotes} autoComplete="off" multiline={3} />
              <InlineStack gap="400">
                <Button submit variant="primary">Save</Button>
                <Button submit disabled={(() => {
                  const hasItems = (scenario.productVariantIds || []).length > 0;
                  const needsProvince = !!countryMeta?.required?.provinceCode;
                  const needsCity = !!countryMeta?.required?.city;
                  const needsAddress1 = !!countryMeta?.required?.address1;
                  const postalOk = countryMeta?.required?.postalCode ? !!postalCode : true;
                  const provinceOk = needsProvince ? !!provinceCode : true;
                  const cityOk = needsCity ? !!city : true;
                  const addrOk = needsAddress1 ? !!address1 : true;
                  return !(hasItems && postalOk && provinceOk && cityOk && addrOk) || zipStateMismatch;
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
                {(Array.isArray(variants) ? variants : []).filter(Boolean).map((v: any, idx: number) => (
                  <span key={v?.id ?? idx} style={{ border: '1px solid var(--p-color-border)', borderRadius: 12, padding: '2px 8px' }}>
                    {(v?.productTitle ?? 'Item')} {v?.title ? `(${v.title})` : ''} ×{scenario.quantities[idx] || 1} {v?.grams ? `(${v.grams >= 1000 ? (v.grams/1000).toFixed(1)+' kg' : v.grams+' g'})` : ''}
                  </span>
                ))}
              </InlineStack>
              {Array.isArray(profiles) && profiles.length > 0 ? (
                <Text variant="bodySm" as="p">Profiles covered: {profiles.join(', ')}</Text>
              ) : null}
              {(Array.isArray(variants) ? variants : []).some((v: any) => !v?.requiresShipping || (v?.grams ?? 0) === 0) ? (
                <Text tone="caution" variant="bodySm" as="p">Some items are non-shippable or have 0 weight; rates may be missing.</Text>
              ) : null}
              {Number(freeShip || '0') > 0 && estimatedSubtotal > 0 && estimatedSubtotal < Number(freeShip) ? (
                <Text tone="caution" variant="bodySm" as="p">This cart is below the threshold; free-shipping won’t be validated.</Text>
              ) : null}
            </BlockStack>
          ) : null}
          <InlineStack>
            <Button onClick={() => navigate(`/app/scenarios/${scenario.id}/items?modal=1`)}>
              Edit items
            </Button>
          </InlineStack>
        </Card>
        {!isNew ? (
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Danger zone</Text>
            <Form method="post" onSubmit={(e) => { if (!confirm('Delete this scenario? This cannot be undone.')) { e.preventDefault(); } }}>
              <input type="hidden" name="intent" value="delete" />
              <Button tone="critical" submit>Delete scenario</Button>
            </Form>
          </BlockStack>
        </Card>
        ) : null}
      </BlockStack>
      )}
    </Page>
  );
}

