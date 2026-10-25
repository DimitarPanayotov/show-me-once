import { os } from '@orpc/server';

export const router = {
  health: os.handler(async () => ({ status: 'ok' as const, service: 'show-me-once' })),
};
