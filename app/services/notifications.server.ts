export async function sendSlack(webhookUrl: string, text: string) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

type EmailPayload = {
  to: string;
  subject: string;
  text: string;
};

export async function sendEmailViaResend(payload: EmailPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        text: payload.text,
      }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}


