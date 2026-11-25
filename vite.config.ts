import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function resolvePiperPhonemizeEntry(): string {
  const distDir = path.resolve(__dirname, 'node_modules/@diffusionstudio/vits-web/dist');
  const match = fs
    .readdirSync(distDir)
    .find((file) => /^piper-[^.]+\.js$/.test(file));
  if (!match) {
    throw new Error('Impossible de trouver le module piper_phonemize dans @diffusionstudio/vits-web.');
  }
  return path.join(distDir, match);
}

const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig(() => {
  return {
    base: '/sonobande/',
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@piper-phonemize': resolvePiperPhonemizeEntry(),
      },
    },
    server: {
      headers: CROSS_ORIGIN_ISOLATION_HEADERS,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      headers: CROSS_ORIGIN_ISOLATION_HEADERS,
    },
  };
});
