import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';

export const SESSION_COOKIE = 'smo_session';
const SESSION_DAYS = 7;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, saltText, hashText] = stored.split(':');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = scryptSync(password, Buffer.from(saltText, 'base64url'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db().session.create({
    data: {
      userId,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export async function registerAccount(email: string, password: string, name?: string) {
  if (await db().user.findUnique({ where: { email } })) throw new Error('EMAIL_EXISTS');
  const user = await db().user.create({ data: { email, name: name || null, passwordHash: hashPassword(password) } });
  return { token: await issueSession(user.id), user: { id: user.id, email: user.email, name: user.name } };
}

export async function loginAccount(email: string, password: string) {
  const user = await db().user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) throw new Error('INVALID_CREDENTIALS');
  return { token: await issueSession(user.id), user: { id: user.id, email: user.email, name: user.name } };
}

export async function revokeSession(token: string): Promise<void> {
  await db().session.deleteMany({ where: { tokenHash: tokenHash(token) } });
}

export async function sessionUser(token: string | null | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const session = await db().session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}

export function tokenFromRequest(request: Request): string | null {
  const bearer = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') ?? '');
  if (bearer) return bearer[1]!;
  const cookie = request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie?.slice(SESSION_COOKIE.length + 1) ?? null;
}
