import { createECDH, createHash, createPrivateKey, createPublicKey, sign, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pairingTranscript, type PairingProof } from '@show-me-once/shared/pairing';

export type BrowserBinding = { origin: string; instanceId: string; token: string };
export type ConnectorIdentity = { publicKey: string; sign(proof: PairingProof): string };

export function connectorIdentity(agentToken: string): ConnectorIdentity {
  // Domain-separated identity derived from the existing private root credential.
  // This keeps identity stable across automatic restarts without another setup file.
  const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const seed = createHash('sha256').update('show-me-once/connector-identity/v1\0').update(agentToken).digest('hex');
  const scalar = Buffer.from(((BigInt('0x' + seed) % (order - 1n)) + 1n).toString(16).padStart(64, '0'), 'hex');
  const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(scalar);
  const point = ecdh.getPublicKey();
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
    d: scalar.toString('base64url'), x: point.subarray(1,33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64url');
  return { publicKey, sign: proof => sign('sha256', Buffer.from(pairingTranscript(proof)), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
}

export async function browserBindings(home: string) {
  const file = join(home, 'mcp-browsers.json');
  let bindings: BrowserBinding[] = [];
  try {
    bindings = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(bindings) || bindings.length > 20 || bindings.some(b =>
      !/^chrome-extension:\/\/[a-p]{32}$/.test(b.origin) || !/^[a-f0-9-]{36}$/.test(b.instanceId) || !/^[A-Za-z0-9_-]{32,128}$/.test(b.token))) throw new Error('Invalid browser bindings.');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return {
    bindings,
    async save(next: BrowserBinding[]) {
      const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      try { await rename(temporary, file); }
      finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
    },
  };
}
