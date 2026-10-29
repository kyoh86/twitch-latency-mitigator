import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/catch-up.js', import.meta.url), 'utf8');
function fixture({ currentTime = 10, ranges = [[0, 40]], duration = Infinity, ad = false, ...state } = {}) {
  const writes = [];
  const video = {
    isConnected: true, paused: false, seeking: false, readyState: 4, ...state,
    buffered: { length: ranges.length, start: i => ranges[i][0], end: i => ranges[i][1] },
    __reactFiber$test: { memoizedProps: { mediaPlayerInstance: {
      getLiveLatency: () => 30, getDuration: () => duration,
    } } },
    get currentTime() { return currentTime; },
    set currentTime(value) { currentTime = value; writes.push(value); },
  };
  const window = {};
  const document = { querySelector: selector => selector === '.video-player video' ? video : ad ? {} : null };
  vm.runInNewContext(source, { window, document, console: { log() {} } });
  return { api: window.twitchCatchUp, writes };
}

test('loading and previewing do not seek; jump retains two seconds of the current buffer', () => {
  const f = fixture();
  assert.deepEqual(f.writes, []);
  assert.equal(f.api.preview().skipSeconds, 28);
  assert.deepEqual(f.writes, []);
  assert.equal(f.api.jump().jumped, true);
  assert.deepEqual(f.writes, [38]);
});

test('does not cross an unbuffered gap', () => {
  const f = fixture({ ranges: [[0, 15], [30, 45]] });
  f.api.jump();
  assert.deepEqual(f.writes, [13]);
});

test('does not seek when already near the buffer edge', () => {
  const f = fixture({ currentTime: 38.5 });
  assert.equal(f.api.jump().jumped, false);
  assert.deepEqual(f.writes, []);
});

for (const [name, state] of Object.entries({
  paused: { paused: true }, seeking: { seeking: true }, detached: { isConnected: false },
  buffering: { readyState: 2 }, VOD: { duration: 3600 }, advertisement: { ad: true },
  outsideBuffer: { currentTime: 50 },
})) {
  test('does not seek during ' + name, () => {
    const f = fixture(state);
    assert.throws(() => f.api.jump());
    assert.deepEqual(f.writes, []);
  });
}
