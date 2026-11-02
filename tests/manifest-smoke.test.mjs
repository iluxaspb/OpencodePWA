import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('manifest.webmanifest корректен и иконки существуют', () => {
  const manifestPath = join(ROOT, 'manifest.webmanifest');
  assert.ok(existsSync(manifestPath), 'manifest.webmanifest должен существовать');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length > 0, 'name задано');
  assert.equal(typeof manifest.short_name, 'string');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons), 'icons должен быть массивом');
  assert.ok(manifest.icons.length >= 2, 'должно быть не менее 2 иконок');
  for (const icon of manifest.icons) {
    assert.ok(icon.src, 'иконка должна иметь src');
    const p = join(ROOT, icon.src.replace(/^\.\//, ''));
    assert.ok(existsSync(p), `файл иконки ${icon.src} должен существовать`);
    assert.ok(statSync(p).size > 0, `файл иконки ${icon.src} не должен быть пустым`);
    assert.equal(icon.type, 'image/png');
  }
});
