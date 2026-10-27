import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/mpala-dashboard/', 
  server: {
    proxy: {
      '/de-africa': {
        target: 'https://ows.digitalearthafrica.africa',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/de-africa/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      },
    },
  },
});