import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildVerificationEmail } from "../utils/verification_email";
import logo from "../assets/branding/setcraft-email-logo.json";

const directory = resolve(__dirname, "../build/email-preview");
mkdirSync(directory, { recursive: true });
const message = buildVerificationEmail(
  "123456",
  "https://preview.invalid/setcraft-logo.png",
);
// Relative local PNG is for the browser preview only; delivery uses public HTTPS.
writeFileSync(
  resolve(directory, "setcraft-logo.png"),
  Buffer.from(logo.base64, "base64"),
);
writeFileSync(
  resolve(directory, "verification.html"),
  message.html.replace(
    "https://preview.invalid/setcraft-logo.png",
    "setcraft-logo.png",
  ),
);
writeFileSync(resolve(directory, "verification.txt"), message.text);
console.log(
  `Dummy-code email preview: ${resolve(directory, "verification.html")}`,
);
