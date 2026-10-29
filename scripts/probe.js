// Paste into the DevTools console on a Twitch channel page.
// Observation only: does not change playback, settings, or make requests.
(() => {
  const video = document.querySelector('video');
  if (!video) throw new Error('No Twitch video element found.');
  let fiber;
  for (let element = video; element && !fiber; element = element.parentElement) {
    const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
    if (key) fiber = element[key];
  }
  // React and mediaPlayerInstance are private APIs and may change.
  let player;
  for (let node = fiber, depth = 0; node && depth < 60; node = node.return, depth++) {
    const candidate = node.memoizedProps?.mediaPlayerInstance;
    if (typeof candidate?.getLiveLatency === 'function' &&
        typeof candidate?.getBufferDuration === 'function') {
      player = candidate;
      break;
    }
  }
  if (!player) throw new Error('Twitch player not found; private API may have changed.');
  const ranges = value => Array.from({ length: value.length }, (_, i) =>
    [value.start(i), value.end(i)]);
  const snapshot = () => ({
    at: new Date().toISOString(),
    connected: video.isConnected,
    latencySeconds: player.getLiveLatency(),
    bufferSeconds: player.getBufferDuration(),
    lowLatency: player.isLiveLowLatency?.(),
    state: player.getState?.(),
    playerRate: player.getPlaybackRate?.(),
    videoRate: video.playbackRate,
    paused: video.paused,
    currentTime: video.currentTime,
    buffered: ranges(video.buffered),
    seekable: ranges(video.seekable),
    // A hint only; absence is not proof that an ad is not playing.
    adLabelPresent: !!document.querySelector('[data-a-target="video-ad-label"]'),
  });
  window.twitchLatencyProbe = Object.freeze({
    snapshot,
    async sample(seconds = 15) {
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
        throw new RangeError('Sample duration must be an integer from 1 to 60 seconds.');
      }
      const samples = [snapshot()];
      for (let i = 0; i < seconds; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!video.isConnected) throw new Error('Player replaced; run probe.js again.');
        samples.push(snapshot());
      }
      console.table(samples.map(({ buffered, seekable, ...row }) => row));
      return samples;
    },
  });
  console.table([snapshot()]);
  return window.twitchLatencyProbe;
})();
