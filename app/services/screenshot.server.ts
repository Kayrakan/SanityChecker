import { chromium } from "playwright";

export async function captureCheckoutScreenshot(checkoutUrl: string, options?: { timeoutMs?: number; storefrontPassword?: string }): Promise<Buffer> {
  const timeoutMs = options?.timeoutMs ?? 30000;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // Optional: bypass storefront password page (common on dev stores)
    if (options?.storefrontPassword) {
      const passwordInput = page.locator('input[type="password"], input[name="password"]');
      if (await passwordInput.count().catch(() => 0)) {
        try {
          await passwordInput.first().fill(options.storefrontPassword, { timeout: 3000 });
          const enterButton = page.locator('button[type="submit"], button:has-text("Enter")');
          if (await enterButton.count().catch(() => 0)) {
            await enterButton.first().click({ timeout: 3000 }).catch(() => {});
          }
          await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
          // After unlocking, revisit checkout in case the theme redirected to home
          await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => {});
        } catch {}
      }
    }

    // Fill email if needed to advance to shipping step
    const emailInput = page.locator('input[name="checkout[email]"]');
    if (await emailInput.count().catch(() => 0)) {
      await emailInput.first().fill("sanity-checker@example.com").catch(() => {});
    }

    // Try to proceed to shipping step if a continue button is present
    const continueButton = page.locator('button[type="submit"], button[name="button"], button:has-text("Continue")');
    if (await continueButton.count().catch(() => 0)) {
      try {
        await continueButton.first().click({ trial: false, delay: 50 });
        await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs / 2 });
      } catch {}
    }

    // Wait for shipping rates UI if possible (best-effort)
    const shippingRatesRadio = page.locator('input[name="checkout[shipping_rate][id]"]');
    try {
      await shippingRatesRadio.first().waitFor({ timeout: timeoutMs / 2 });
    } catch {}

    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    return buffer;
  } finally {
    await context.close();
    await browser.close();
  }
}


