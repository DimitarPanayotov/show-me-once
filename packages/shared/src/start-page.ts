import { sanitizeUrl } from './index.ts';
import { containsSecret } from './agent.ts';

/** A starting address is an input, never a browser observation or run-log value. */
export function checkedStartUrl(raw: unknown, checkpoint?: string): string {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(raw)) throw new Error('Invalid starting address.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid starting address.'); }
  let decoded = raw;
  try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } }
  catch { throw new Error('Invalid starting address.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
    decoded.includes('…') || containsSecret(decoded) || /[\u0000-\u001f\u007f\\]/.test(decoded) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(decoded) ||
    /[A-Za-z0-9_-]{32,}/.test(decoded.slice(decoded.indexOf('://') + 3).replace(/^[^/]+/, '')) ||
    /(?:^|[\/_. -])(?:delete|remove|destroy|logout|signout|sign-out|unsubscribe|checkout|payment|pay|purchase|transfer|confirm|execute|submit|reset|cancel)(?:$|[\/_. -])/i.test(decoded))
    throw new Error('Use a public starting address without credentials, query values or action endpoints.');
  if (checkpoint && sanitizeUrl(url.href) !== checkpoint)
    throw new Error('The starting address must match the skill’s first origin and path depth.');
  return url.href;
}
