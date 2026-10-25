import assert from 'node:assert/strict';
import test from 'node:test';
import { requestApi } from './api.ts';

test('extension sign-in explicitly omits an existing website session cookie', async () => {
  const result = await requestApi('https://library.example', 'auth/login', { email: 'demo@example.test', password: 'dummy-password' }, undefined, async (url, init) => {
    assert.equal(url, 'https://library.example/api/rpc/auth/login');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return Response.json({ json: { token: 'extension-session' } });
  });
  assert.deepEqual(result, { token: 'extension-session' });
});

test('authenticated library requests use a bearer token while still omitting cookies', async () => {
  const result = await requestApi('https://library.example', 'skill/list', {}, 'extension-session', async (_url, init) => {
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer extension-session');
    return Response.json({ json: [] });
  });
  assert.deepEqual(result, []);
});

test('plain-text Forbidden becomes an actionable HTTP error instead of a JSON syntax error', async () => {
  await assert.rejects(
    requestApi('https://library.example', 'auth/login', {}, undefined, async () => new Response('Forbidden', { status: 403 })),
    { message: 'The library rejected this request (403). Please sign in again.' },
  );
});

test('structured authentication errors keep the server message', async () => {
  await assert.rejects(
    requestApi('https://library.example', 'auth/login', {}, undefined, async () => Response.json({ json: { message: 'Invalid email or password.' } }, { status: 401 })),
    { message: 'Invalid email or password.' },
  );
});

test('a non-JSON success response is rejected without exposing its body', async () => {
  await assert.rejects(
    requestApi('https://library.example', 'skill/list', {}, undefined, async () => new Response('<html>upstream response</html>')),
    { message: 'The library returned an unexpected response. Please try again.' },
  );
});
