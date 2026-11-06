import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, child, children, text, textOf } from '../src/xml.js';

test('XML を木にする', () => {
  const root = parseXml(`﻿<?xml version="1.0"?>
<!DOCTYPE a [ <!ENTITY x "y"> ]>
<!-- コメント -->
<a k="1" j='two &amp; three' gt="a>b">
  <b>こんにちは &lt;&#x41;&#66;&gt;</b>
  <c/>
  <b><![CDATA[<そのまま>]]></b>
  <d><e>深い</e></d>
</a>`);
  assert.equal(root.name, 'a');
  assert.deepEqual(root.attrs, { k: '1', j: 'two & three', gt: 'a>b' });
  assert.equal(text(child(root, 'b')), 'こんにちは <AB>');
  assert.equal(children(root, 'b').length, 2);
  assert.equal(text(children(root, 'b')[1]), '<そのまま>');
  assert.ok(child(root, 'c'));
  assert.equal(textOf(root, 'd/e'), '深い');
  assert.equal(textOf(root, 'd/x'), '');
});

test('こわれた XML はエラーになる', () => {
  assert.throws(() => parseXml('<a><b></a>'));
  assert.throws(() => parseXml('<a>'));
  assert.throws(() => parseXml('ただの文字'));
});
