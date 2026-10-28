// Browser and connector use the same transcript. No credentials enter the displayed code.
export type PairingProof = {
  pairingId: string; bridgeId: string; origin: string; instanceId: string;
  publicKey: string; clientNonce: string; serverNonce: string;
};
export function pairingTranscript(proof: PairingProof) {
  return JSON.stringify(['show-me-once-pairing-v1', proof.pairingId, proof.bridgeId,
    proof.origin, proof.instanceId, proof.publicKey, proof.clientNonce, proof.serverNonce]);
}
export function encodeBytes(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(value)) throw new Error('Invalid connection proof.');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
export async function nonceCommitment(nonce: string) {
  return encodeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))));
}
export async function pairingCode(proof: PairingProof) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pairingTranscript(proof)));
  return String(new DataView(digest).getUint32(0) % 1_000_000).padStart(6, '0');
}
export async function verifyPairingProof(proof: PairingProof, signature: string) {
  const key = await crypto.subtle.importKey('spki', decodeBytes(proof.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decodeBytes(signature), new TextEncoder().encode(pairingTranscript(proof)));
}
