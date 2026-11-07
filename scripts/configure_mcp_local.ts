import {randomBytes} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Local setup only. Never prints a credential or modifies an existing hash key.
async function main() {
  const url = new URL(process.argv[2] ?? '');
  if (url.protocol !== 'https:' || url.pathname !== '/mcp' || url.search || url.hash || url.username || url.password) throw new Error('Supply the public HTTPS /mcp URL.');
  const path = resolve('.env');
  let source = await readFile(path, 'utf8');
  if (!/^MCP_TOKEN_HASH_KEY_BASE64=.+$/m.test(source)) {
    source = source.replace(/^MCP_TOKEN_HASH_KEY_BASE64=.*\r?\n?/m, '');
    source += `\nMCP_TOKEN_HASH_KEY_BASE64=${randomBytes(32).toString('base64')}\n`;
  }
  source = source.replace(/^MCP_PUBLIC_URL=.*\r?\n?/m, '');
  source += `MCP_PUBLIC_URL=${url.toString()}\n`;
  await writeFile(path, source, {encoding: 'utf8', mode: 0o600});
  console.log('Local MCP URL and a persistent hash key are configured. No secret was displayed.');
}
main().catch(() => {console.error('MCP configuration failed. No credentials were displayed.'); process.exitCode = 1;});
