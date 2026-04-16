'use strict';

// Minimal Svelte component loader for Node tests.
// Compiles a `.svelte` file (recursively, if it imports other `.svelte`
// components) to SSR format, writes to a temp directory that mirrors the
// source tree, then dynamic-imports the result.
//
// Relative imports of `.svelte` are rewritten to `.mjs` pointing at the
// compiled sibling. Relative imports of `.js` are copied through to the temp
// tree with extension preserved. `import.meta.env.VITE_API_URL` is rewritten
// to `globalThis.__TEST_API_URL` so tests can control the API base.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { compile } = require('svelte/compiler');

const ROOT = path.resolve(__dirname, '..', 'frontend', 'src');

function patchEnv(code) {
  return code.replace(/import\.meta\.env\.VITE_API_URL/g, '(globalThis.__TEST_API_URL)');
}

function rewriteSvelteImports(code, baseDir, outDir) {
  // import X from './foo.svelte' → import X from '<outDir>/.../foo.svelte.mjs'
  return code.replace(
    /from\s*(['"])([^'"]+\.svelte)\1/g,
    (_, q, rel) => {
      const absSrc = path.resolve(baseDir, rel);
      const relFromRoot = path.relative(ROOT, absSrc);
      const outFile = path.join(outDir, relFromRoot) + '.mjs';
      return `from ${q}${pathToFileURL(outFile).href}${q}`;
    }
  );
}

function rewriteJsImports(code, baseDir, outDir, jsVisited) {
  // import X from './bar.js' → absolute file:// URL pointing to a *transformed*
  // copy of the .js file in the temp tree (so `import.meta.env.VITE_API_URL`
  // gets patched before we import it).
  return code.replace(
    /from\s*(['"])(\.{1,2}\/[^'"]+)\1/g,
    (_, q, rel) => {
      if (rel.endsWith('.svelte')) return `from ${q}${rel}${q}`; // handled above
      let absSrc = path.resolve(baseDir, rel);
      if (!path.extname(absSrc)) absSrc += '.js';
      if (!fs.existsSync(absSrc)) return `from ${q}${pathToFileURL(absSrc).href}${q}`;
      const relFromRoot = path.relative(ROOT, absSrc);
      const outFile = path.join(outDir, relFromRoot);
      if (!jsVisited.has(absSrc)) {
        jsVisited.add(absSrc);
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        let src = fs.readFileSync(absSrc, 'utf8');
        src = patchEnv(src);
        // Recurse to patch imports inside this .js too (keep relative paths
        // relative — we'll rewrite them on the fly when we write this file).
        src = rewriteJsImports(src, path.dirname(absSrc), outDir, jsVisited);
        fs.writeFileSync(outFile, src);
      }
      return `from ${q}${pathToFileURL(outFile).href}${q}`;
    }
  );
}

async function compileComponentTree(svelteFile, opts = {}) {
  const mode = opts.generate || 'ssr';
  const outDir = opts.outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'svelte-t-'));
  const visited = new Set();
  const jsVisited = new Set();

  function walk(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const src = fs.readFileSync(file, 'utf8');
    const name = path.basename(file, '.svelte');
    const relFromRoot = path.relative(ROOT, file);
    const outFile = path.join(outDir, relFromRoot) + '.mjs';
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const result = compile(src, { generate: mode, name, filename: file, css: 'injected' });
    let code = result.js.code;
    const baseDir = path.dirname(file);
    code = rewriteSvelteImports(code, baseDir, outDir);
    code = rewriteJsImports(code, baseDir, outDir, jsVisited);
    code = patchEnv(code);
    fs.writeFileSync(outFile, code);

    // Recurse into child .svelte imports
    const importRe = /from\s*['"]([^'"]+\.svelte)['"]/g;
    let m;
    while ((m = importRe.exec(src)) !== null) {
      const childPath = path.resolve(baseDir, m[1]);
      if (fs.existsSync(childPath)) walk(childPath);
    }
  }

  walk(path.resolve(svelteFile));
  const entry = path.join(outDir, path.relative(ROOT, path.resolve(svelteFile))) + '.mjs';
  const mod = await import(pathToFileURL(entry).href + '?t=' + Date.now() + Math.random());
  return { Component: mod.default, outDir };
}

module.exports = { compileComponentTree, ROOT };
