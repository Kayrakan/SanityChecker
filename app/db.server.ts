import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

async function connectWithRetry(client: PrismaClient) {
  const maxAttempts = Number.parseInt(process.env.PRISMA_CONNECT_RETRIES ?? '5', 10);
  const baseDelay = Number.parseInt(process.env.PRISMA_CONNECT_RETRY_DELAY_MS ?? '2000', 10);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await client.$connect();
      return; // Connected successfully
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const wait = baseDelay * attempt;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

function createClient() {
  const client = new PrismaClient();
  const skipInitialConnect = process.env.PRISMA_SKIP_CONNECT_ON_BOOT === "1";
  if (!skipInitialConnect) {
    void (async () => {
      try {
        await connectWithRetry(client);
      } catch (error) {
        console.error("Failed to connect to the database after retries", error);
        try {
          await client.$disconnect();
        } catch {
          // ignore disconnect failures; we're exiting anyway
        }
        process.exit(1);
      }
    })();
  }
  return client;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createClient();
  }
}

const prisma: PrismaClient = global.prismaGlobal ?? createClient();

export default prisma;
