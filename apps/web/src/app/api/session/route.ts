import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loginAccount, registerAccount, revokeSession, SESSION_COOKIE, tokenFromRequest } from '@/server/auth';

export const runtime = 'nodejs';

const credentials = z.object({
  mode: z.enum(['login', 'register']),
  email: z.email().transform(value => value.toLowerCase()),
  password: z.string().min(1).max(128),
  name: z.string().trim().max(80).optional(),
});

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = credentials.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email and password.' }, { status: 400 });
  const { mode, email, password, name } = parsed.data;
  if (mode === 'register' && password.length < 12) {
    return NextResponse.json({ error: 'Use at least 12 characters for the password.' }, { status: 400 });
  }
  try {
    const { token, user } = mode === 'register'
      ? await registerAccount(email, password, name)
      : await loginAccount(email, password);
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      path: '/', maxAge: 7 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_EXISTS') {
      return NextResponse.json({ error: 'An account already uses this email.' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'INVALID_CREDENTIALS') {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const token = tokenFromRequest(request);
  if (token) await revokeSession(token);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
