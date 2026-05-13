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

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const isBackground = mode === 'background';
    const isContent = mode === 'content';
    const isInterceptor = mode === 'interceptor';

    return {
      ...commonConfig,
      build: {
        outDir: 'build',
        // Important: only empty the dir on the very first pass
        emptyOutDir: isBackground, 
        lib: {
          entry: isBackground 
            ? resolve(__dirname, 'src/background/background.ts') 
            : isContent 
              ? resolve(__dirname, 'src/content/index.ts')
              : resolve(__dirname, 'src/content/network-interceptor.ts'),
          formats: [isBackground ? 'es' : 'iife'],
          name: isContent ? 'VttContent' : isInterceptor ? 'VttInterceptor' : undefined,
          fileName: (format) => {
            if (isBackground) return 'src/background/background.js';
            if (isContent) return 'src/content/index.js';
            if (isInterceptor) return 'src/content/network-interceptor.js';
            return 'bundle.js';
          }
        },
        rollupOptions: {
          output: {
            extend: true,
          }
        }
      },
      plugins: [
        // Only copy static files on the first pass
        isBackground && viteStaticCopy({
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
            {
              src: 'src/assets/icons/*.png',
              dest: 'src/assets/icons',
              rename: { stripBase: true }
            }
          ],
        }),
        isContent && {
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
      ].filter(Boolean),
    };
  }
  return commonConfig;
});
