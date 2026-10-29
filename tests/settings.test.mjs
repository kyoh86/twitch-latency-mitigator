import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const bridgeSource = readFileSync(new URL('../extension/settings-bridge.js', import.meta.url), 'utf8');
const optionsSource = readFileSync(new URL('../extension/options.js', import.meta.url), 'utf8');
const catalogs = Object.fromEntries(['en', 'ja'].map(lang => [lang, JSON.parse(readFileSync(new URL(`../_locales/${lang}/messages.json`, import.meta.url), 'utf8'))]));
const i18n = lang => ({
  getUILanguage: () => lang,
  getMessage: (key, value) => catalogs[lang][key].message.replace('$SECONDS$', value ?? ''),
});
const flush = () => new Promise(resolve => setImmediate(resolve));

function bridge() {
  const messages = [];
  let resolveRead, onMessage, onChange;
  const window = {
    postMessage: data => messages.push(data),
    addEventListener: (_, listener) => { onMessage = listener; },
  };
  const origin = 'https://www.twitch.tv';
  const chrome = { i18n: i18n('ja'), storage: {
    local: { get: () => new Promise(resolve => { resolveRead = resolve; }) },
    onChanged: { addListener: listener => { onChange = listener; } },
  } };
  vm.runInNewContext(bridgeSource, { window, location: { origin }, chrome });
  return {
    messages, resolveRead,
    request() { onMessage({ source: window, origin, data: {
      source: 'twitch-latency-mitigator', type: 'request-settings',
    } }); },
    change(value) { onChange({ defaultEnabled: { newValue: value } }, 'local'); },
  };
}

test('startup request waits for the saved default rather than sending a temporary OFF', async () => {
  const b = bridge();
  b.request();
  assert.equal(b.messages.length, 0);
  b.resolveRead({ defaultEnabled: true });
  await flush();
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].defaultEnabled, true);
  b.request();
  assert.equal(b.messages[1].defaultEnabled, true);
});

test('an in-flight initial read cannot overwrite a more recent preference change', async () => {
  const b = bridge();
  b.change(true);
  b.resolveRead({ defaultEnabled: false });
  await flush();
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].defaultEnabled, true);
  b.change(undefined); // Removing the stored preference restores OFF.
  assert.equal(b.messages[1].defaultEnabled, false);
});

function options({ failSave = false, failLoad = false, lang = 'ja' } = {}) {
  let onChange;
  const checkbox = { checked: false, disabled: true, addEventListener: (_, fn) => { onChange = fn; } };
  const status = { textContent: '' };
  const writes = [];
  const chrome = { i18n: i18n(lang), storage: { local: {
    get: async () => { if (failLoad) throw Error('load'); return { defaultEnabled: true }; },
    set: async value => { if (failSave) throw Error('save'); writes.push(value.defaultEnabled); },
  } } };
  const translated = Object.fromEntries(['optionsHeading', 'defaultEnabledLabel'].map(key => [key, { dataset: { i18n: key }, textContent: '' }]));
  const document = { documentElement: {}, querySelectorAll: () => Object.values(translated), getElementById: id => id === 'default-enabled' ? checkbox : status };
  vm.runInNewContext(optionsSource, { document, chrome });
  return { checkbox, status, writes, translated, document, change: () => onChange() };
}

test('options restore the saved selection and persist both ON and OFF', async () => {
  const o = options();
  await flush();
  assert.equal(o.checkbox.checked, true);
  assert.equal(o.checkbox.disabled, false);
  o.checkbox.checked = false;
  await o.change();
  o.checkbox.checked = true;
  await o.change();
  assert.deepEqual(o.writes, [false, true]);
});

test('a failed save restores the previous selection and permits retry', async () => {
  const o = options({ failSave: true });
  await flush();
  o.checkbox.checked = false;
  await o.change();
  assert.equal(o.checkbox.checked, true);
  assert.equal(o.checkbox.disabled, false);
  assert.match(o.status.textContent, /保存できません/);
});

test('a failed initial load cannot overwrite an unknown saved preference', async () => {
  const o = options({ failLoad: true });
  await flush();
  assert.equal(o.checkbox.disabled, true);
  assert.match(o.status.textContent, /読み込めません/);
});


test('English options localize labels and save feedback', async () => {
  const o = options({ lang: 'en' });
  await flush();
  assert.equal(o.document.documentElement.lang, 'en');
  assert.equal(o.translated.defaultEnabledLabel.textContent, 'Follow live by default (ON)');
  o.checkbox.checked = false;
  await o.change();
  assert.match(o.status.textContent, /^Saved/);
});

test('both catalogs cover all manifest, options and player strings with matching placeholders', () => {
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs.ja).sort());
  const html = readFileSync(new URL('../extension/options.html', import.meta.url), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) {
    assert.ok(catalogs.en[key]?.message);
    assert.ok(catalogs.ja[key]?.message);
  }
  for (const catalog of Object.values(catalogs)) {
    assert.equal(catalog.jumped.placeholders.seconds.content, '$1');
    assert.match(catalog.jumped.message, /\$SECONDS\$/);
  }
});
