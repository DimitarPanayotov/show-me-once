import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Show Me Once',
    description: 'Record a browser task safely, then turn it into a reusable skill.',
    permissions: ['storage', 'tabs', 'scripting', 'activeTab'],
  },
});
