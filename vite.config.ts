import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const commonConfig = {
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
};

export default defineConfig(({ command }) => {
  if (command === 'build') {
    return {
      ...commonConfig,
      build: {
        outDir: 'build',
        emptyOutDir: true,
        rollupOptions: {
          input: {
            background: resolve(__dirname, 'src/background/background.ts'),
            content: resolve(__dirname, 'src/content/index.ts'),
          },
          output: {
            // We use 'es' format but we will fix the content script issue
            // Actually, let's try 'cjs' which doesn't use 'export default' by default in the same way, 
            // but it might use 'exports'.
            // The best is 'iife' but it requires single entry.
            // So we'll use a little trick: we'll use 'es' and then a manual fix or just use 'iife' by splitting.
            format: 'es', 
            entryFileNames: (chunkInfo) => {
              if (chunkInfo.name === 'background') {
                return 'src/background/background.js';
              }
              if (chunkInfo.name === 'content') {
                return 'src/content/index.js';
              }
              return '[name].js';
            },
          },
        },
      },
      plugins: [
        viteStaticCopy({
          targets: [
            {
              src: 'manifest.json',
              dest: '.',
            },
            {
              src: 'src/assets/styles.css',
              dest: 'src/assets',
              rename: { stripBase: true }
            },
          ],
        }),
        {
          name: 'remove-export-statement',
          generateBundle(options, bundle) {
            for (const fileName in bundle) {
              if (fileName.includes('content/index.js')) {
                const chunk = bundle[fileName];
                if (chunk.type === 'chunk') {
                  // Remove 'export { ... }' or 'export default ...'
                  chunk.code = chunk.code.replace(/export\s+\{\s*.*?\s*\}?;?/g, '');
                  chunk.code = chunk.code.replace(/export\s+default\s+.*?;?/g, '');
                  // Wrap in IIFE to be safe
                  chunk.code = `(function() {\n${chunk.code}\n})();`;
                }
              }
            }
          }
        }
      ],
    };
  }
  return commonConfig;
});
