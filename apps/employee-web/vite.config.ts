import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.RENUKA_API_ORIGIN || 'http://localhost:3000';
  const proxy = { '/api': { target, changeOrigin: true } };
  return {
    server: { port: 5174, proxy },
    preview: { port: 4174, proxy },
    plugins: [
      react(),
      tailwind(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        manifest: {
          name: 'Renuka FieldForce',
          short_name: 'Renuka CRM',
          description: 'Employee attendance and field visits',
          id: '/',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#F8F5ED',
          theme_color: '#102B23',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallbackDenylist: [/^\/api(?:\/|$)/],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  };
});
