import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import {
  buildVerificationEmail,
  emailLogoUrl,
  EMAIL_LOGO_PATH,
  OTP_EXPIRY_MINUTES,
} from "../utils/verification_email";
import { emailBrandingRoutes } from "../utils/email_branding";
import logo from "../assets/branding/setcraft-email-logo.json";

async function main() {
  const message = buildVerificationEmail(
    "012345",
    "https://cdn.example.com/logo.png?a=1&b=2",
  );
  assert.match(message.html, />012345<\/p>/);
  assert.match(message.text, /\n012345\n/);
  assert.match(message.html, /a=1&amp;b=2/);
  assert.match(message.html, new RegExp(`${OTP_EXPIRY_MINUTES} minutes`));
  assert.match(message.text, new RegExp(`${OTP_EXPIRY_MINUTES} minutes`));
  assert.match(message.text, /Never share/);
  assert.match(message.text, /safely ignore/);
  assert.doesNotMatch(message.subject, /012345/);
  assert.doesNotMatch(message.html, /<script|<button|data:image|cid:/i);
  for (const code of ["12345", "1234567", "<img/>", "123 45"]) {
    assert.throws(() => buildVerificationEmail(code));
  }
  assert.equal(
    emailLogoUrl({ PUBLIC_APP_URL: "https://api.example.com/api/" }),
    `https://api.example.com${EMAIL_LOGO_PATH}`,
  );
  assert.equal(
    emailLogoUrl({ MCP_PUBLIC_URL: "https://api.example.com/mcp" }),
    `https://api.example.com${EMAIL_LOGO_PATH}`,
  );
  assert.equal(
    emailLogoUrl({ EMAIL_LOGO_URL: "https://cdn.example.com/brand.png" }),
    "https://cdn.example.com/brand.png",
  );
  assert.equal(
    emailLogoUrl({
      PUBLIC_APP_URL: "https://new.example.com",
      MCP_PUBLIC_URL: "https://old.example.com/mcp",
    }),
    `https://new.example.com${EMAIL_LOGO_PATH}`,
  );
  for (const url of [
    "http://example.com/a.png",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "",
  ]) {
    assert.equal(emailLogoUrl({ EMAIL_LOGO_URL: url }), undefined);
    assert.doesNotMatch(buildVerificationEmail("123456", url).html, /<img/);
  }
  assert.match(buildVerificationEmail("123456", "").html, />Setcraft<\/td>/);
  const image = Buffer.from(logo.base64, "base64");
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  // Source check applies only in the checkout; the runtime asset is self-contained.
  if (
    !__dirname.includes(
      `${require("node:path").sep}dist${require("node:path").sep}`,
    )
  ) {
    assert.deepEqual(
      image,
      readFileSync(
        resolve(__dirname, "../../mobile/assets/branding/setcraft-icon.png"),
      ),
    );
  }

  const app = express();
  app.use(emailBrandingRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}${EMAIL_LOGO_PATH}`,
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /image\/png/);
    assert.match(response.headers.get("cache-control")!, /immutable/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  // Block all external fetches, then exercise the actual Brevo SDK serialization.
  const originalFetch = globalThis.fetch;
  let payload: Record<string, any> | undefined;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(init?.body as string);
    return new Response(JSON.stringify({ messageId: "mock-email" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const { sendEmail } = await import("../config/brevo");
    await sendEmail(
      "preview@example.invalid",
      message.subject,
      message.html,
      message.text,
    );
    assert(payload);
    assert.equal(payload.htmlContent, message.html);
    assert.equal(payload.textContent, message.text);
    assert.equal(payload.subject, message.subject);
    assert.deepEqual(payload.to, [{ email: "preview@example.invalid" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(
    "PASS: verification email content, safe URLs, logo endpoint, and mocked Brevo delivery",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
