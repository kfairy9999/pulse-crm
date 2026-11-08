import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

// Component checks use React server rendering only; no browser automation is launched.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.jsx')) return { format: 'module', shortCircuit: true, source: transformSync(readFileSync(fileURLToPath(url), 'utf8'), { jsx: 'automatic', loader: 'jsx', target: 'node22', sourcefile: fileURLToPath(url) }).code };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    return nextLoad(url, context);
  },
});
