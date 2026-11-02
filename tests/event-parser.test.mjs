import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, parseSocketEvent } from '../js/core/event-parser.js';

test('KINDS экспортированы', () => {
  assert.equal(KINDS.CONTENT, 'content');
  assert.equal(KINDS.DONE, 'done');
  assert.equal(KINDS.ERROR, 'error');
  assert.equal(KINDS.SESSION_ID, 'session_id');
  assert.equal(KINDS.STATUS, 'status');
});

test('parseSocketEvent: не-строка -> null', () => {
  assert.equal(parseSocketEvent(undefined), null);
  assert.equal(parseSocketEvent(null), null);
  assert.equal(parseSocketEvent(123), null);
  assert.equal(parseSocketEvent({}), null);
});

test('parseSocketEvent: SSE data с content', () => {
  const evt = parseSocketEvent('data: {"type":"content","text":"привет"}');
  assert.equal(evt.kind, 'content');
  assert.equal(evt.text, 'привет');
});

test('parseSocketEvent: SSE data с session_id', () => {
  const evt = parseSocketEvent('data: {"type":"session_id","session_id":"abc123"}');
  assert.equal(evt.kind, 'session_id');
  assert.equal(evt.meta.session_id, 'abc123');
});

test('parseSocketEvent: done c stop_reason', () => {
  const evt = parseSocketEvent('data: {"type":"done","stop_reason":"end_turn"}');
  assert.equal(evt.kind, 'done');
  assert.equal(evt.meta.stop_reason, 'end_turn');
});

test('parseSocketEvent: error с message', () => {
  const evt = parseSocketEvent('{"type":"error","error":"boom"}');
  assert.equal(evt.kind, 'error');
  assert.equal(evt.meta.message, 'boom');
});

test('parseSocketEvent: плоский JSON текст -> content', () => {
  const evt = parseSocketEvent('просто текст');
  assert.equal(evt.kind, 'content');
  assert.equal(evt.text, 'просто текст');
});

test('parseSocketEvent: payload-обёртка', () => {
  const evt = parseSocketEvent('data: {"type":"content","payload":{"text":"обёртка"}}');
  assert.equal(evt.kind, 'content');
  assert.equal(evt.text, 'обёртка');
});

test('parseSocketEvent: неизвестный тип -> status', () => {
  const evt = parseSocketEvent('{"type":"чёт/что-нибудь"}');
  assert.equal(evt.kind, 'status');
});
