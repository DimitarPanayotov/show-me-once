import { RPCHandler } from '@orpc/server/fetch';
import { router } from '@/server/router';
import { sessionUser, tokenFromRequest } from '@/server/auth';

const handler = new RPCHandler(router);

async function handleRequest(request: Request) {
  const origin = request.headers.get('origin');
  const allowedExtensionOrigin = process.env.EXTENSION_ORIGIN;
  const cors: Record<string, string> = origin && origin === allowedExtensionOrigin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    Vary: 'Origin',
  } : {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const token = tokenFromRequest(request);
  if (token && !request.headers.has('authorization') && request.method !== 'GET'
    && origin !== new URL(request.url).origin) {
    return new Response('Forbidden', { status: 403, headers: cors });
  }
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: { user: await sessionUser(token), token },
  });
  const result = response ?? new Response('Not found', { status: 404 });
  for (const [name, value] of Object.entries(cors)) result.headers.set(name, value);
  return result;
}

export const GET = handleRequest;
export const POST = handleRequest;
export const OPTIONS = handleRequest;
