import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODE, buildBase, buildWsUrl, createOpenCodeTransport, createTransport } from '../js/core/api-client.js';

test('MODE содержит ожидаемые значения', () => {
  assert.equal(MODE.MOCK, 'mock');
  assert.equal(MODE.OPENCODE, 'opencode');
  assert.ok(Object.isFrozen(MODE));
});

test('buildBase: http по умолчанию', () => {
  assert.equal(buildBase({ host: 'localhost', port: 8080 }), 'http://localhost:8080');
});

test('buildBase: https', () => {
  assert.equal(buildBase({ host: 'example.com', port: 443, scheme: 'https' }), 'https://example.com:443');
});

test('buildBase: без host возвращает пустую строку', () => {
  assert.equal(buildBase({}), '');
  assert.equal(buildBase(undefined), '');
});

test('buildBase: некорректный порт игнорируется', () => {
  assert.equal(buildBase({ host: 'h', port: 'abc' }), 'http://h');
  assert.equal(buildBase({ host: 'h', port: 0 }), 'http://h');
  assert.equal(buildBase({ host: 'h', port: -5 }), 'http://h');
});

test('buildBase: пустой порт не добавляется', () => {
  assert.equal(buildBase({ host: 'h', port: '' }), 'http://h');
});

test('buildBase: scheme wss нормализуется в https', () => {
  assert.equal(buildBase({ host: 'h', scheme: 'wss' }), 'https://h');
});

test('buildWsUrl: ws для http', () => {
  assert.equal(buildWsUrl({ host: 'h', port: 8080 }), 'ws://h:8080');
});

test('buildWsUrl: wss для https', () => {
  assert.equal(buildWsUrl({ host: 'h', port: 8443, scheme: 'https' }), 'wss://h:8443');
});

test('buildWsUrl: без host пустая строка', () => {
  assert.equal(buildWsUrl({}), '');
});
