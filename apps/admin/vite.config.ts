import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __VERCEL_API_PROXY__: JSON.stringify(process.env.VERCEL === '1') },
  preview: {
    proxy: process.env.RENDER_API_ORIGIN
      ? { '/api/': { target: process.env.RENDER_API_ORIGIN, changeOrigin: true } }
      : undefined,
  },
});
