// 作用域检查：找出「用了但没声明」的标识符（parser 只查语法，查不到这个）
// 用法：node scope-check.js <file...>
const parser = require('@babel/parser');
const traverseMod = require('@babel/traverse');
const fs = require('fs');
const traverse = traverseMod.default || traverseMod;

// 允许的全局
const GLOBALS = new Set([
  'console', 'Math', 'JSON', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean',
  'Promise', 'Set', 'Map', 'WeakMap', 'Symbol', 'Error', 'TypeError', 'RegExp',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'FormData', 'AbortController',
  'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'undefined', 'NaN', 'Infinity', 'global', 'globalThis', 'require', '__DEV__',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'Intl', 'BigInt', 'alert', 'void',
]);

function checkFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parser.parse(src, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties'],
    });
  } catch (e) {
    return [{ file, line: 0, name: 'PARSE', msg: e.message }];
  }
  const bad = [];
  const report = (path, name) => {
    if (!name || GLOBALS.has(name)) return;
    if (path.scope.hasBinding(name, true)) return;
    if (path.scope.hasGlobal(name)) return;
    bad.push({ file, line: path.node.loc ? path.node.loc.start.line : 0, name, msg: '未声明使用' });
  };

  traverse(ast, {
    // 普通标识符引用（JSX 表达式里的变量也算这个）
    ReferencedIdentifier(path) {
      if (path.isJSXIdentifier()) return; // JSX 名字单独处理
      report(path, path.node.name);
    },
    // JSX 元素名：<Foo /> 的 Foo 才是引用；style= / onPress= 这些是属性名，不是引用
    JSXOpeningElement(path) {
      const n = path.node.name;
      if (n.type === 'JSXIdentifier') {
        const name = n.name;
        if (/^[a-z]/.test(name)) return; // <view> 之类原生标签跳过
        report(path, name);
      }
    },
  });
  return bad;
}

const files = process.argv.slice(2);
let total = 0;
for (const f of files) {
  const res = checkFile(f);
  if (res.length) {
    total += res.length;
    for (const r of res) console.log(`${r.file}:${r.line}  ${r.name}  ${r.msg}`);
  }
}
console.log(total === 0 ? 'SCOPE OK: 没有未声明标识符' : `SCOPE ISSUES: ${total}`);
