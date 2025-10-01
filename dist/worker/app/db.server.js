import { PrismaClient } from "@prisma/client";
async function connectWithRetry(client) {
    const maxAttempts = Number.parseInt(process.env.PRISMA_CONNECT_RETRIES ?? '5', 10);
    const baseDelay = Number.parseInt(process.env.PRISMA_CONNECT_RETRY_DELAY_MS ?? '2000', 10);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await client.$connect();
            return; // Connected successfully
        }
        catch (error) {
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
    void (async () => {
        try {
            await connectWithRetry(client);
        }
        catch (error) {
            console.error("Failed to connect to the database after retries", error);
            try {
                await client.$disconnect();
            }
            catch (_a) {
            }
            process.exit(1);
        }
    })();
    return client;
}
if (process.env.NODE_ENV !== "production") {
    if (!global.prismaGlobal) {
        global.prismaGlobal = createClient();
    }
}
const prisma = global.prismaGlobal ?? createClient();
export default prisma;
