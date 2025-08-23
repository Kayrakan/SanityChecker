import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link as RemixLink } from "@remix-run/react";
import { Page, Card, IndexTable, Text, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  const runs = shop ? await prisma.run.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { scenario: true },
  }) : [];
  return json({ runs });
};

export default function RunsIndex() {
  const { runs } = useLoaderData<typeof loader>();
  return (
    <Page title="Runs">
      <Card>
        <IndexTable
          resourceName={{ singular: 'run', plural: 'runs' }}
          itemCount={runs.length}
          headings={[{ title: 'Scenario' }, { title: 'Status' }, { title: 'Started' }]}
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
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}


