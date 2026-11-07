# Setcraft verification email

OTP delivery uses `utils/verification_email.ts` for matching HTML and plain text.
The expiry label and Redis TTL share the same ten-minute constant. The code is a
single selectable text node; email clients do not require JavaScript or a copy
button. The subject and preview text do not expose the code.

The template uses table layout, system fonts, inline style fallbacks, a narrow
mobile layout and optional dark-mode overrides. It keeps a visible Setcraft
wordmark if the recipient blocks images. It does not include marketing links,
invented support addresses or an unsubscribe action in the account email.

## Logo delivery

Set `PUBLIC_APP_URL` to the backend's public HTTPS origin, or `EMAIL_LOGO_URL`
to the same logo on a public CDN. For existing installations, the origin in
`MCP_PUBLIC_URL` is used when neither email setting is configured. Without a
valid HTTPS origin the message still sends with the Setcraft text wordmark.
See `.env.email.example`.

The unauthenticated `/branding/setcraft-email-logo-v1.png` endpoint serves the
existing app icon. Its JSON asset stores the original PNG bytes so TypeScript
copies the asset into `dist` automatically; there is no dependency on the mobile
checkout at runtime. When updating the logo, regenerate its base64 from
`mobile/assets/branding/setcraft-icon.png` and version the public path to avoid
old cached images.

Deploy/restart the backend before testing actual delivery. The configured public
origin must remain reachable by email image proxies; development tunnels expire.
Brevo's transactional API does not offer inline Content-ID image configuration:
https://developers.brevo.com/reference/send-transac-email

The sender's Gmail avatar/verified mark is controlled by separate provider/domain
branding settings, not this HTML template. No DNS or sender account settings are
changed here.

## Local checks and preview

- `npm run test:email` tests the template, packaged image endpoint and a mocked
  Brevo request. It never sends a real email or connects to Redis.
- `npm run preview:email` writes a dummy-code HTML preview and text alternative
  under `build/email-preview/`. No real account data is used.
- `npm run build` compiles the template and packages the logo for deployment.

Browser previews check layout only. Actual Gmail/Outlook rendering and sender
identity still need an inbox check after deployment.
