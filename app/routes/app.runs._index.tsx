import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link as RemixLink, useRevalidator, Form } from "@remix-run/react";
import { useEffect } from "react";
import { Page, Card, IndexTable, Text, Badge, Button, Select, InlineStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = String(url.searchParams.get("status") || "").toUpperCase();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  let runs: any[] = [];
  if (shop) {
    const where: any = { shopId: shop.id };
    if (status && ["PENDING","PASS","WARN","FAIL","ERROR","BLOCKED"].includes(status)) {
      where.status = status as any;
    }
    if (from || to) {
      const createdAt: any = {};
      if (from) createdAt.gte = new Date(from);
      if (to) createdAt.lte = new Date(`${to}T23:59:59.999Z`);
      where.createdAt = createdAt;
    }
    runs = await prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { scenario: true },
    });
  }
  return json({ runs, filters: { status, from, to } });
};

export default function RunsIndex() {
  const { runs, filters } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        revalidator.revalidate();
      }
    }, 3000);
    return () => clearInterval(id);
  }, [revalidator]);
  return (
    <Page title="Runs">
      <Card>
        <IndexTable
          resourceName={{ singular: 'run', plural: 'runs' }}
          itemCount={runs.length}
          headings={[{ title: 'Scenario' }, { title: 'Status' }, { title: 'Started' }, { title: 'Duration' }, { title: 'Actions' }]}
          selectable={false}
        >
          {runs.map((r: any, idx: number) => (
            <IndexTable.Row id={r.id} key={r.id} position={idx}>
              <IndexTable.Cell>
                <RemixLink to={`/app/runs/${r.id}`}>
                  <Text as="span" variant="bodyMd">{r.scenario?.name ?? 'Scenario'}</Text>
                </RemixLink>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Badge tone={r.status === 'PASS' ? 'success' : r.status === 'WARN' ? 'attention' : r.status === 'FAIL' || r.status === 'ERROR' ? 'critical' : 'new'}>{r.status}</Badge>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" variant="bodyMd">{new Date(r.startedAt).toLocaleString()}</Text>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" variant="bodyMd">{r.finishedAt ? Math.max(0, new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) + ' ms' : '—'}</Text>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Form method="post" action={`/app/runs/${r.id}`}>
                  <Button submit size="slim">Re-run</Button>
                </Form>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}

