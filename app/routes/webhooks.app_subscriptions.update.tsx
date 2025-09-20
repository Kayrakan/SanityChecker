import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}:`, JSON.stringify(payload, null, 2));

    // The payload contains the app subscription details
    const subscription = payload as {
      id: string;
      name: string;
      status: string;
      created_at: string;
      updated_at: string;
      trial_ends_on?: string;
      current_period_end?: string;
      test: boolean;
      line_items: Array<{
        id: string;
        plan: {
          id: string;
          name: string;
        };
        usage_records: any[];
      }>;
    };

    console.log(`App subscription ${subscription.id} status: ${subscription.status} for shop: ${shop}`);

    // Log subscription status changes for debugging
    if (subscription.status === "ACTIVE") {
      console.log(`✅ Subscription activated for ${shop}: ${subscription.name}`);
    } else if (subscription.status === "CANCELLED") {
      console.log(`❌ Subscription cancelled for ${shop}: ${subscription.name}`);
    } else if (subscription.status === "EXPIRED") {
      console.log(`⏰ Subscription expired for ${shop}: ${subscription.name}`);
    } else if (subscription.status === "FROZEN") {
      console.log(`🧊 Subscription frozen for ${shop}: ${subscription.name}`);
    } else if (subscription.status === "PENDING") {
      console.log(`⏳ Subscription pending for ${shop}: ${subscription.name}`);
    }

    // Update any local billing state if needed
    // For now, we rely on the billing.check() method to get current status
    // but you could store subscription details in your database here if needed

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Error processing app_subscriptions/update webhook:", error);
    return new Response("Error", { status: 500 });
  }
};
