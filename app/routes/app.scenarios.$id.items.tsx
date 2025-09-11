import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigate, useLocation } from "@remix-run/react";
import {
  Page,
  Card,
  TextField,
  Button,
  BlockStack,
  Text,
  InlineStack,
  Badge,
  IndexTable,
  Autocomplete,
  Select,
  Checkbox,
  InlineGrid,
  Divider,
  Box,
  Banner,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const scenario = await prisma.scenario.findUnique({ where: { id: String(params.id) } });
  if (!scenario) throw new Response("Not Found", { status: 404 });
  return json({ scenario });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const variantIds = String(form.get("variantIds") || "").split(/\s*,\s*/).filter(Boolean);
  const quantities = String(form.get("quantities") || "").split(/\s*,\s*/).map(v => Number(v) || 1);
  await prisma.scenario.update({ where: { id: String(params.id) }, data: { productVariantIds: variantIds, quantities } });
  return redirect(`/app/scenarios/${params.id}/items?modal=1&itemsSaved=1`);
};

type Row = {
  id: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  imageUrl?: string | null;
  price?: number;
  currencyCode?: string;
  grams: number;
  weightKg: number;
  requiresShipping: boolean;
  inventory: number;
  vendor?: string;
  productType?: string;
};

type SortKey = "TITLE" | "SKU" | "PRICE" | "WEIGHT";

function useDebounced<T>(value: T, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function ScenarioItems() {
  const { scenario } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const app = useAppBridge();
  const [justSaved, setJustSaved] = useState<boolean>(false);

  // Filters & search
  const [term, setTerm] = useState("");
  const [collectionId, setCollectionId] = useState(""); // GID string
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [requiresShipping, setRequiresShipping] = useState<boolean | undefined>(undefined);
  const [inStock, setInStock] = useState<boolean | undefined>(undefined);
  const [minWeight, setMinWeight] = useState<string>("");
  const [maxWeight, setMaxWeight] = useState<string>("");
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("TITLE");
  const [direction, setDirection] = useState<"ASC" | "DESC">("ASC");

  const debouncedTerm = useDebounced(term, 350);
  const [collectionOptions, setCollectionOptions] = useState<{ value: string; label: string }[]>([
    { value: "", label: "Any" },
  ]);
  const [collectionQuery, setCollectionQuery] = useState("");
  const [collectionLabel, setCollectionLabel] = useState("");
  const [collectionFocused, setCollectionFocused] = useState(false);
  const skipNextCollectionsFetch = useRef(false);
  const [collectionSelected, setCollectionSelected] = useState<string[]>([]);
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [productTypeOptions, setProductTypeOptions] = useState<string[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const debouncedCollectionQuery = useDebounced(collectionQuery, 300);

  // Paging
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const cursorStack = useRef<string[]>([]); // for Prev

  const pageSize = 25;

  // Show success banner/toast when redirected with itemsSaved flag
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const itemsSaved = params.get('itemsSaved') === '1';
    if (itemsSaved) {
      setJustSaved(true);
      try { app.toast.show('Items saved'); } catch {}
    }
  }, [location.search, app]);

  async function readJsonSafe(res: Response): Promise<any> {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      // Normalize non-JSON responses (e.g., text errors) into a friendly error
      const snippet = String(text || '').slice(0, 200);
      throw new Error(snippet || 'Unexpected response');
    }
  }

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedTerm) params.set("term", debouncedTerm);
    if (collectionId) params.set("collectionId", collectionId);
    if (vendor) params.set("vendor", vendor);
    if (productType) params.set("productType", productType);
    if (requiresShipping !== undefined) params.set("requiresShipping", String(requiresShipping));
    if (inStock !== undefined) params.set("inStock", String(inStock));
    if (minWeight) params.set("minWeight", minWeight);
    if (maxWeight) params.set("maxWeight", maxWeight);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    params.set("sort", sort);
    params.set("direction", direction);
    params.set("pageSize", String(pageSize));
    return params;
  }, [debouncedTerm, collectionId, vendor, productType, requiresShipping, inStock, minWeight, maxWeight, minPrice, maxPrice, sort, direction]);

  const fetchPage = useCallback(async (cursor?: string, pushCursor = false) => {
    setLoading(true); setError(null);
    try {
      const url = new URL("/api/variant-search", window.location.origin);
      const params = new URLSearchParams(queryParams);
      if (cursor) params.set("cursor", cursor);
      url.search = params.toString();
      const res = await fetch(url.toString());
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "We couldn’t reach Shopify right now—retry in a moment.");
      const items: Row[] = data.items || [];
      setRows(items);
      setHasNextPage(!!data?.pageInfo?.hasNextPage);
      setEndCursor(data?.pageInfo?.endCursor || null);
      if (pushCursor) {
        if (cursor) cursorStack.current.push(cursor);
      } else if (!cursor) {
        cursorStack.current = []; // reset when fresh search
      }
    } catch (e: any) {
      setError(e?.message || "Unexpected error");
      setRows([]);
      setHasNextPage(false);
      setEndCursor(null);
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  // Trigger fetch on first load and whenever filters change (debounced term)
  useEffect(() => { fetchPage(); }, [fetchPage]);

  // Fetch vendor and product type facets once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/internal/facets?limit=200");
        const data = await readJsonSafe(res);
        if (Array.isArray(data?.vendors)) setVendorOptions(data.vendors);
        if (Array.isArray(data?.productTypes)) setProductTypeOptions(data.productTypes);
      } catch (e:any) {
        // Silently ignore; facets are optional
        console.warn('facets fetch failed', e?.message);
      }
    })();
  }, []);

  // Collection suggestions (debounced)
  useEffect(() => {
    (async () => {
      try {
        const url = new URL("/internal/collections", window.location.origin);
        if (debouncedCollectionQuery) url.searchParams.set("q", debouncedCollectionQuery);
        url.searchParams.set("limit", "20");
        if (skipNextCollectionsFetch.current) { skipNextCollectionsFetch.current = false; return; }
        const res = await fetch(url.toString());
        const data = await readJsonSafe(res);
        const options = Array.isArray(data?.options) ? data.options : [];
        setCollectionOptions([{ value: "", label: "Any" }, ...options]);
      } catch (e:any) {
        console.warn('collections fetch failed', e?.message);
      }
    })();
  }, [debouncedCollectionQuery]);

  // Keep Autocomplete selection in sync with filter value
  useEffect(() => { setCollectionSelected(collectionId ? [collectionId] : []); }, [collectionId]);
  useEffect(() => {
    const label = collectionOptions.find(o => o.value === collectionId)?.label || "";
    setCollectionLabel(label);
  }, [collectionId, collectionOptions]);

  // Selection state
  const [selected, setSelected] = useState<{ id: string; row: Row; qty: number }[]>(() => {
    const ids = (scenario.productVariantIds ?? []) as string[];
    const qtys = (scenario.quantities ?? []) as number[];
    return ids.map((id, i) => ({ id, row: { id, productTitle: "", variantTitle: "", sku: "", grams: 0, weightKg: 0, requiresShipping: true, inventory: 0 }, qty: qtys[i] ?? 1 })).slice(0, 10);
  });

  const isSelected = useCallback((id: string) => selected.some(s => s.id === id), [selected]);

  const addOrToggle = useCallback((row: Row) => {
    setSelected(prev => {
      const exists = prev.find(p => p.id === row.id);
      if (exists) return prev; // de-dupe
      if (prev.length >= 10) return prev; // cap 10
      return [...prev, { id: row.id, row, qty: 1 }];
    });
  }, []);

  const removeSel = useCallback((id: string) => setSelected(prev => prev.filter(p => p.id !== id)), []);
  const setQty = useCallback((id: string, qty: number) => setSelected(prev => prev.map(p => p.id === id ? { ...p, qty: Math.max(1, Math.min(999, Math.floor(qty || 1))) } : p)), []);

  const totals = useMemo(() => {
    const totalWeight = selected.reduce((sum, s) => sum + (s.row.weightKg || s.row.grams / 1000) * s.qty, 0);
    const subtotal = selected.reduce((sum, s) => sum + (s.row.price || 0) * s.qty, 0);
    return { totalWeight, subtotal };
  }, [selected]);

  const canSave = selected.length > 0;

  // Profiles: detect mixed profiles across selected lines
  useEffect(() => {
    const ids = selected.map(s => s.id);
    if (ids.length === 0) { setProfileNames({}); return; }
    const params = new URLSearchParams();
    ids.forEach(id => params.append("id", id));
    fetch(`/internal/variant-profiles?${params.toString()}`).then(async (r) => {
      const d = await readJsonSafe(r);
      setProfileNames(d?.profiles || {});
    }).catch(() => {});
  }, [JSON.stringify(selected.map(s => s.id).sort())]);
  const mixedProfiles = useMemo(() => {
    const names = Object.values(profileNames).map(n => (n || "").trim()).filter(Boolean);
    return new Set(names).size > 1;
  }, [profileNames]);

  // Sorting options
  const sortOptions: { label: string; value: SortKey }[] = [
    { label: "Title", value: "TITLE" },
    { label: "SKU", value: "SKU" },
    { label: "Price (page)", value: "PRICE" },
    { label: "Weight (page)", value: "WEIGHT" },
  ];

  // Render
  return (
    <Page title="Scenario Items">
      <BlockStack gap="400">
        {justSaved && (
          <Banner
            title="Items saved"
            tone="success"
            onDismiss={() => {
              // Make dismissal instant without any navigation/state changes
              setJustSaved(false);
            }}
          >
            <p>Your selected items and quantities have been saved.</p>
          </Banner>
        )}
        <Card>
          <BlockStack gap="200">
            <InlineGrid columns={{ xs: 1, md: 4 }} gap="200">
              <TextField label="Search title or SKU…" value={term} onChange={setTerm} autoComplete="off" placeholder="Search title or SKU…" />
              <Autocomplete
                options={collectionOptions}
                selected={collectionSelected}
                onSelect={(sel) => {
                  const id = (sel as string[])[0] || "";
                  setCollectionId(id);
                  const label = collectionOptions.find(o => o.value === id)?.label || "";
                  setCollectionLabel(label);
                  // Show the selected label immediately in the field, without triggering a refetch
                  skipNextCollectionsFetch.current = true;
                  setCollectionQuery(label);
                }}
                textField={
                  <Autocomplete.TextField
                    label="Collection"
                    value={collectionFocused ? collectionQuery : (collectionLabel || collectionQuery)}
                    onChange={(v) => {
                      setCollectionQuery(v);
                    }}
                    onFocus={() => { setCollectionFocused(true); /* keep current value to avoid immediate fetch */ }}
                    onBlur={() => { setCollectionFocused(false); }}
                    clearButton
                    onClearButtonClick={() => {
                      setCollectionId("");
                      setCollectionSelected([]);
                      setCollectionQuery("");
                      setCollectionLabel("");
                    }}
                    autoComplete="off"
                    placeholder="Search collections…"
                  />
                }
              />
              <Select
                label="Vendor/Brand"
                options={[{ label: "Any", value: "" }, ...vendorOptions.map(v => ({ label: v, value: v }))]}
                value={vendor}
                onChange={setVendor}
              />
              <Select
                label="Product type"
                options={[{ label: "Any", value: "" }, ...productTypeOptions.map(t => ({ label: t, value: t }))]}
                value={productType}
                onChange={setProductType}
              />
            </InlineGrid>
            <InlineGrid columns={{ xs: 1, md: 5 }} gap="200">
              <Select label="Sort" options={sortOptions} value={sort} onChange={(v) => { setSort(v as SortKey); }} />
              <Select label="Direction" options={[{label:"Asc", value:"ASC"},{label:"Desc", value:"DESC"}]} value={direction} onChange={(v) => { setDirection(v as any); }} />
              <Checkbox label="Requires shipping" checked={requiresShipping === true} onChange={(v) => setRequiresShipping(v ? true : undefined)} helpText="Toggle on to require shipping; off to ignore" />
              <Checkbox label="In stock" checked={inStock === true} onChange={(v) => setInStock(v ? true : undefined)} helpText="Toggle on to show only inventory > 0" />
              <Box>
                <Text as="p" variant="bodySm">Weight range (kg)</Text>
                <InlineStack gap="200" align="start">
                  <TextField label="Min" labelHidden type="number" value={minWeight} onChange={setMinWeight} autoComplete="off" />
                  <TextField label="Max" labelHidden type="number" value={maxWeight} onChange={setMaxWeight} autoComplete="off" />
                </InlineStack>
              </Box>
            </InlineGrid>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="200">
              <Box>
                <Text as="p" variant="bodySm">Price range</Text>
                <InlineStack gap="200" align="start">
                  <TextField label="Min" labelHidden type="number" value={minPrice} onChange={setMinPrice} autoComplete="off" />
                  <TextField label="Max" labelHidden type="number" value={maxPrice} onChange={setMaxPrice} autoComplete="off" />
                </InlineStack>
              </Box>
            </InlineGrid>
            {error && <Text tone="critical">{error}</Text>}
            {!error && debouncedTerm.length > 0 && debouncedTerm.length < 2 && !collectionId && (
              <Text tone="subdued">Type at least 2 characters or choose a Collection to search.</Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <IndexTable
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: "Image" },
              { title: "Product" },
              { title: "Variant" },
              { title: "SKU" },
              { title: "Price" },
              { title: "Weight (kg)" },
              { title: "Ship." },
              { title: "Stock" },
              { title: "Select/Qty" },
            ]}
          >
            {loading && rows.length === 0 ? (
              <IndexTable.Row id="loading" position={0}>
                <IndexTable.Cell colSpan={9}>
                  <Text>Loading…</Text>
                </IndexTable.Cell>
              </IndexTable.Row>
            ) : rows.length === 0 ? (
              <IndexTable.Row id="empty" position={0}>
                <IndexTable.Cell colSpan={9}>
                  <Text>No matches. Try removing filters or searching by SKU.</Text>
                </IndexTable.Cell>
              </IndexTable.Row>
            ) : (
              rows.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell>
                    {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" decoding="async" width={40} height={40} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} /> : <Box background="bg-fill-tertiary" width="40px" height="40px" />}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">{r.productTitle}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{r.variantTitle}</IndexTable.Cell>
                  <IndexTable.Cell>{r.sku || "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{r.price != null ? `${r.price.toFixed(2)}${r.currencyCode ? " " + r.currencyCode : ""}` : "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{(r.weightKg ?? r.grams / 1000).toFixed(3)}</IndexTable.Cell>
                  <IndexTable.Cell>{r.requiresShipping ? "🚚" : "—"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {r.inventory > 0 ? r.inventory : <Badge tone="attention">OOS</Badge>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Checkbox
                      label={isSelected(r.id) ? "Added" : "Add"}
                      checked={isSelected(r.id)}
                      disabled={!isSelected(r.id) && selected.length >= 10}
                      onChange={(checked) => {
                        if (checked) addOrToggle(r); else removeSel(r.id);
                      }}
                    />
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))
            )}
          </IndexTable>
          <InlineStack align="space-between" blockAlign="center" gap="200" padding="200">
            <Button
              disabled={cursorStack.current.length === 0 || loading}
              onClick={() => {
                cursorStack.current.pop();
                // To go prev, we need to refetch without the last cursor in the stack; then read the previous cursor
                const prevCursor = cursorStack.current.length > 0 ? cursorStack.current[cursorStack.current.length - 1] : undefined;
                fetchPage(prevCursor, false);
              }}
            >Prev</Button>
            <InlineStack gap="200" align="center">
              {loading && <Text tone="subdued">Loading…</Text>}
              <Button
                variant="primary"
                disabled={!hasNextPage || loading}
                onClick={() => {
                  if (endCursor) fetchPage(endCursor, true);
                }}
              >Next</Button>
            </InlineStack>
          </InlineStack>
        </Card>

        <div style={{ position: "sticky", bottom: 0, zIndex: 10, background: "white" }}>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Selected items ({selected.length}/10)</Text>
            {selected.length >= 10 && (
              <Text tone="subdued">You’ve selected 10 items (max). Scenarios model a small cart.</Text>
            )}
            {selected.length === 0 ? (
              <Text tone="subdued">No items selected.</Text>
            ) : (
              <BlockStack gap="200">
                {selected.map((s) => (
                  <InlineStack key={s.id} align="space-between" blockAlign="center" gap="200">
                    <InlineStack gap="200">
                      <Text fontWeight="semibold">{s.row.productTitle || "Variant"}</Text>
                      <Text>• {s.row.variantTitle || s.id.split("/").pop()}</Text>
                      {!s.row.requiresShipping && <Badge tone="subdued">Non-shippable</Badge>}
                      {(s.row.grams === 0) && <Badge tone="subdued">Weight=0</Badge>}
                      {s.row.inventory === 0 && <Badge tone="attention">OOS</Badge>}
                    </InlineStack>
                    <InlineStack gap="200">
                      <TextField
                        label="Qty"
                        labelHidden
                        type="number"
                        min={1}
                        value={String(s.qty)}
                        onChange={(v) => setQty(s.id, Number(v))}
                        autoComplete="off"
                      />
                      <Button onClick={() => removeSel(s.id)}>Remove</Button>
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
            <Divider />
            <InlineStack align="space-between">
              <InlineStack gap="400">
                <Text>Total weight: {totals.totalWeight.toFixed(3)} kg</Text>
                <Text>Estimated subtotal: {totals.subtotal.toFixed(2)}</Text>
                {mixedProfiles && <Badge tone="subdued">Mixed profiles</Badge>}
              </InlineStack>
              <InlineStack gap="200">
                <Form method="post">
                  <input type="hidden" name="variantIds" value={selected.map(s => s.id).join(",")} />
                  <input type="hidden" name="quantities" value={selected.map(s => s.qty).join(",")} />
                  <Button submit variant="primary" disabled={!canSave}>{canSave ? "Save" : "Save"}</Button>
                </Form>
                <Button onClick={() => {
                  navigate(`/app/scenarios/${(scenario as any).id}`);
                }}>Cancel</Button>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Card>
        </div>

      </BlockStack>
    </Page>
  );
}
