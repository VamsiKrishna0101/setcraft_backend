import { BrevoClient } from "@getbrevo/brevo";
import "dotenv/config";

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY! });

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
) {
  await brevo.transactionalEmails.sendTransacEmail({
    sender: {
      name:
        process.env.BREVO_SENDER_NAME?.replace(/\bFitAI\b/gi, "Setcraft") ||
        "Setcraft",
      email: process.env.BREVO_SENDER_EMAIL,
    },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
  });
}
