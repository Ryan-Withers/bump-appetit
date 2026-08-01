#!/usr/bin/env node
// Every user-facing string lives in assets/js/strings.js, and modules read them
// through small str()/strList() helpers with inline fallbacks. That design has
// one failure mode: a module asks for a key that does not exist, the fallback
// ships, and editing strings.js silently changes nothing on screen. It has
// happened. This script makes it a build failure instead.
//
// It statically collects every literal path passed to str()/strList() across
// assets/js and requires that at least one candidate path resolves in STRINGS.
// Zero dependencies. Run: node scripts/check-strings.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'assets', 'js');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// str('a.b', ...) | str("a.b", ...) | str(['a.b', 'c.d'], ...) | strList(...)
const CALL_RE = /\bstr(?:List)?\(\s*(?:'([^']+)'|"([^"]+)"|\[([^\]]*)\])/g;
const LIST_ITEM_RE = /['"]([^'"]+)['"]/g;

function collectCalls(src, file) {
  const calls = [];
  let m;
  while ((m = CALL_RE.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    if (m[1] || m[2]) {
      calls.push({ file, line, paths: [m[1] || m[2]] });
    } else if (m[3] !== undefined) {
      const paths = [...m[3].matchAll(LIST_ITEM_RE)].map((x) => x[1]);
      if (paths.length) calls.push({ file, line, paths });
    }
  }
  return calls;
}

function resolves(strings, dotted) {
  let node = strings;
  for (const key of dotted.split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return false;
    node = node[key];
  }
  return node !== null && node !== undefined && node !== '';
}

(async () => {
  const { STRINGS } = await import(
    'file://' + path.join(JS_DIR, 'strings.js')
  );

  const failures = [];
  let total = 0;

  for (const file of walk(JS_DIR)) {
    if (file.endsWith('strings.js')) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const call of collectCalls(src, path.relative(ROOT, file))) {
      total += 1;
      if (!call.paths.some((p) => resolves(STRINGS, p))) {
        failures.push(call);
      }
    }
  }

  if (failures.length) {
    console.error(`String lookup check failed: ${failures.length} of ${total} lookups reach no key in strings.js.`);
    console.error('The fallback ships and the authored copy is unreachable. Point the call at a real key:');
    for (const f of failures) {
      console.error(`  ${f.file}:${f.line}  str(${f.paths.map((p) => `'${p}'`).join(' | ')})`);
    }
    process.exit(1);
  }

  console.log(`String lookups are live: all ${total} str()/strList() paths resolve in strings.js.`);
})().catch((error) => {
  console.error('check-strings could not run:', error.message);
  process.exit(1);
});
