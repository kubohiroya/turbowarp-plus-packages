import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeFromReadme, stripSelfReference } from '../scripts/lib/descriptions.mjs';

const NAMES = ['@kubohiroya/turbowarp-app-shell', 'turbowarp-app-shell'];

test('takes the first paragraph under the opening heading', () => {
  const md = `# turbowarp-app-shell

TurboWarp app 向けの DOM shell を提供します。

## インストール

npm i @kubohiroya/turbowarp-app-shell
`;
  assert.equal(
    describeFromReadme(md, { names: NAMES }),
    'TurboWarp app 向けの DOM shell を提供します。',
  );
});

test('joins a paragraph that is soft-wrapped across lines', () => {
  const md = `# x

TurboWarp app 向けの
DOM shell を提供します。

## 次の節
`;
  assert.equal(describeFromReadme(md), 'TurboWarp app 向けの DOM shell を提供します。');
});

test('skips the language switcher and badge rows above the paragraph', () => {
  const md = `# x

[English](README.md) | **日本語**

[![npm](https://img.shields.io/npm/v/x)](https://www.npmjs.com/package/x)

本文はここから始まります。
`;
  assert.equal(describeFromReadme(md), '本文はここから始まります。');
});

test('drops the leading self-reference', () => {
  const md = `# turbowarp-app-shell

@kubohiroya/turbowarp-app-shell は、TurboWarp app 向けの DOM shell です。
`;
  assert.equal(
    describeFromReadme(md, { names: NAMES }),
    'TurboWarp app 向けの DOM shell です。',
  );
});

test('keeps an English subject, where cutting it would leave a fragment', () => {
  const text = 'turbowarp-app-shell provides app-neutral DOM shell primitives.';
  assert.equal(stripSelfReference(text, NAMES), text);
});

test('keeps the self-reference when removing it would leave almost nothing', () => {
  const text = '@kubohiroya/turbowarp-app-shell は shell。';
  assert.equal(stripSelfReference(text, NAMES), text);
});

test('strips inline links and emphasis but keeps their words', () => {
  const md = `# x

[TurboWarp](https://turbowarp.org/) 用の **安全な** \`YAML\` パーサです。
`;
  assert.equal(describeFromReadme(md), 'TurboWarp 用の 安全な YAML パーサです。');
});

test('returns null when the opening section has no prose', () => {
  const md = `# x

- bullet one
- bullet two

## Install

Some prose that belongs to another section.
`;
  assert.equal(describeFromReadme(md), null);
});

test('returns null for empty or missing input', () => {
  assert.equal(describeFromReadme(''), null);
  assert.equal(describeFromReadme(undefined), null);
  assert.equal(describeFromReadme('   \n\n'), null);
});

test('reads a README that opens without a heading', () => {
  assert.equal(describeFromReadme('Plain prose at the very top.\n'), 'Plain prose at the very top.');
});

test('stops at the next heading rather than running into it', () => {
  const md = `# x
First paragraph.
## Next
Second paragraph.
`;
  assert.equal(describeFromReadme(md), 'First paragraph.');
});
