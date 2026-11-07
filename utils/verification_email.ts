export const EMAIL_LOGO_PATH = "/branding/setcraft-email-logo-v1.png";
export const OTP_EXPIRY_MINUTES = 10;

type EmailEnvironment = Partial<
  Record<"EMAIL_LOGO_URL" | "PUBLIC_APP_URL" | "MCP_PUBLIC_URL", string>
>;

function httpsUrl(value: string | undefined): URL | undefined {
  try {
    const url = new URL(value ?? "");
    if (url.protocol === "https:" && !url.username && !url.password) return url;
  } catch {
    /* Missing branding must never prevent verification. */
  }
  return undefined;
}

export function emailLogoUrl(
  env: EmailEnvironment = process.env,
): string | undefined {
  const logo = httpsUrl(env.EMAIL_LOGO_URL);
  if (logo) return logo.href;
  // Existing installations already advertise their public server via MCP.
  const app = httpsUrl(env.PUBLIC_APP_URL) ?? httpsUrl(env.MCP_PUBLIC_URL);
  return app ? new URL(EMAIL_LOGO_PATH, app.origin).href : undefined;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

export function buildVerificationEmail(otp: string, logoUrl = emailLogoUrl()) {
  if (!/^\d{6}$/.test(otp))
    throw new Error("Verification codes must contain six digits");
  const logo = httpsUrl(logoUrl);
  const subject = "Verify your email — Setcraft";
  const text = `SETCRAFT

Verify your email

Enter this verification code in the Setcraft app to continue:

${otp}

This code expires in ${OTP_EXPIRY_MINUTES} minutes. Never share it with anyone.

Didn't request this code? You can safely ignore this email.

Setcraft
This is an automated account verification email.`;

  // Tables and inline fallbacks keep the code readable without media-query support.
  // The code remains one text node so selecting/copying it never adds spaces.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Verify your email — Setcraft</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body { margin: 0 !important; padding: 0 !important; }
    table { border-collapse: collapse; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    @media screen and (max-width: 540px) {
      .outer { padding: 24px 12px !important; }
      .content { padding: 32px 24px !important; }
      .brand { padding: 24px !important; }
      .heading { font-size: 28px !important; line-height: 34px !important; }
      .code { font-size: 32px !important; letter-spacing: 6px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .canvas { background-color: #09090b !important; }
      .card { background-color: #17171a !important; border-color: #303035 !important; }
      .heading { color: #fafafa !important; }
      .copy { color: #bcbcc4 !important; }
      .code-box { background-color: #26262b !important; border-color: #3f3f46 !important; }
      .code { color: #ffffff !important; }
      .label, .footer { color: #a1a1aa !important; }
      .divider { border-color: #303035 !important; }
    }
  </style>
</head>
<body class="canvas" style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;color:#f4f4f5;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Confirm your email to continue with Setcraft. Your code expires in ${OTP_EXPIRY_MINUTES} minutes.</div>
  <table role="presentation" width="100%" class="canvas" style="background-color:#f4f4f5;">
    <tr><td align="center" class="outer" style="padding:48px 16px;">
      <!--[if mso]><table role="presentation" width="520"><tr><td><![endif]-->
      <table role="presentation" width="100%" class="card" style="max-width:520px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:20px;overflow:hidden;">
        <tr><td class="brand" bgcolor="#000000" style="padding:28px 40px;background-color:#000000;border-radius:19px 19px 0 0;">
          <table role="presentation"><tr>
            ${logo ? `<td width="48" style="padding-right:12px;"><img src="${escapeHtml(logo.href)}" width="48" height="48" alt="" style="display:block;width:48px;height:48px;border:0;color:#ffffff;background-color:#000000;"></td>` : ""}
            <td style="font-size:23px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;">Setcraft</td>
          </tr></table>
        </td></tr>
        <tr><td class="content" style="padding:40px;">
          <p class="label" style="margin:0 0 14px;color:#71717a;font-size:10px;font-weight:700;line-height:16px;letter-spacing:2px;">ACCOUNT VERIFICATION</p>
          <h1 class="heading" style="margin:0 0 14px;color:#18181b;font-size:32px;line-height:38px;font-weight:700;letter-spacing:-1px;">Verify your email</h1>
          <p class="copy" style="margin:0 0 28px;color:#52525b;font-size:15px;line-height:24px;">Enter this verification code in the Setcraft app to continue.</p>
          <table role="presentation" width="100%"><tr><td align="center" class="code-box" bgcolor="#f4f4f5" style="padding:24px 12px;background-color:#f4f4f5;border:1px solid #e4e4e7;border-radius:12px;">
            <p class="label" style="margin:0 0 10px;color:#71717a;font-size:10px;font-weight:700;line-height:16px;letter-spacing:1.6px;">YOUR VERIFICATION CODE</p>
            <p class="code" dir="ltr" style="margin:0;color:#18181b;font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;line-height:44px;letter-spacing:8px;white-space:nowrap;">${otp}</p>
          </td></tr></table>
          <p class="copy" style="margin:18px 0 28px;color:#52525b;font-size:13px;line-height:21px;text-align:center;">Expires in <strong>${OTP_EXPIRY_MINUTES} minutes.</strong> Never share this code.</p>
          <table role="presentation" width="100%"><tr><td class="divider" style="border-top:1px solid #e4e4e7;padding-top:24px;">
            <p class="copy" style="margin:0;color:#52525b;font-size:12px;line-height:20px;">Didn’t request this code? You can safely ignore this email.</p>
          </td></tr></table>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <p class="footer" style="max-width:460px;margin:24px 12px 0;color:#71717a;font-size:11px;line-height:18px;">Setcraft<br>This is an automated account verification email.</p>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html, text };
}
