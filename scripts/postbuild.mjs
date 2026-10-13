// GitHub Pages niceties: SPA fallback + disable Jekyll processing.
import { copyFileSync, writeFileSync, existsSync } from 'node:fs';
if (!existsSync('dist/index.html')) throw new Error('dist/index.html missing: build first');
copyFileSync('dist/index.html', 'dist/404.html');
writeFileSync('dist/.nojekyll', '');
console.log('postbuild: wrote dist/404.html and dist/.nojekyll');
