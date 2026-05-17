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
    const isPageScript = mode === 'page-script';

    return {
      ...commonConfig,
      build: {
        outDir: 'build',
        emptyOutDir: isBackground,
        minify: true,
        lib: {
          entry: isBackground
            ? resolve(__dirname, 'src/background/background.ts')
            : isContent
              ? resolve(__dirname, 'src/content/index.ts')
              : resolve(__dirname, 'src/content/page-script.ts'),
          formats: [isBackground ? 'es' : 'iife'],
          name: isContent ? 'YtVttContent' : isPageScript ? 'YtPageScript' : undefined,
          fileName: () => {
            if (isBackground) return 'src/background/background.js';
            if (isContent) return 'src/content/index.js';
            if (isPageScript) return 'src/content/page-script.js';
            return 'bundle.js';
          },
        },
        rollupOptions: {
          output: {
            extend: true,
          },
        },
      },
      plugins: [
        isBackground && viteStaticCopy({
          targets: [
            {
              src: 'manifest.json',
              dest: '.',
              transform: (content) => {
                const manifest = JSON.parse(content);
                manifest.version = process.env.npm_package_version || manifest.version;
                return JSON.stringify(manifest, null, 2);
              },
            },
            {
              src: '../rezka/src/assets/styles.css',
              dest: 'src/assets',
              rename: { stripBase: true },
            },
            {
              src: '../rezka/src/assets/icons/*.png',
              dest: 'src/assets/icons',
              rename: { stripBase: true },
            },
          ],
        }),
        isContent && {
          name: 'remove-export-statement',
          generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
            for (const fileName in bundle) {
              if (fileName.includes('content/index.js')) {
                const chunk = bundle[fileName];
                if (chunk.type === 'chunk' && chunk.code) {
                  chunk.code = chunk.code.replace(/export\s+\{\s*.*?\s*\}?;?/g, '');
                  chunk.code = chunk.code.replace(/export\s+default\s+.*?;?/g, '');
                  chunk.code = `(function() {\n${chunk.code}\n})();`;
                }
              }
            }
          },
        },
      ].filter(Boolean),
    };
  }
  return commonConfig;
});
