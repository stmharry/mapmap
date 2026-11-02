import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [vinext()],
  server: {host:'127.0.0.1',port:3211,proxy:{'/api':'http://127.0.0.1:3210','/media':'http://127.0.0.1:3210'}},
});
