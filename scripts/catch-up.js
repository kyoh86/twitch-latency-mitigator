// Paste into Twitch DevTools. Loading this script does not change playback.
// twitchCatchUp.preview() inspects; twitchCatchUp.jump() skips buffered content.
(() => {
  function inspect() {
    const video = document.querySelector('.video-player video');
    if (!video || !video.isConnected || video.paused || video.seeking || video.readyState < 3) {
      throw new Error('A playing, non-seeking video is required.');
    }
    if (document.querySelector('[data-a-target="video-ad-label"]')) {
      throw new Error('Wait for the advertisement to finish.');
    }
    let fiber, player;
    for (let node = video; node && !fiber; node = node.parentElement) {
      const key = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
      if (key) fiber = node[key];
    }
    for (let node = fiber, i = 0; node && i < 60; node = node.return, i++) {
      const candidate = node.memoizedProps?.mediaPlayerInstance;
      if (typeof candidate?.getLiveLatency === 'function') {
        player = candidate;
        break;
      }
    }
    if (!player || player.getDuration?.() !== Infinity) {
      throw new Error('A Twitch live player is required; private API may have changed.');
    }
    const current = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
      const start = video.buffered.start(i), end = video.buffered.end(i);
      if (start <= current && current < end && Number.isFinite(end)) {
        // Retain two seconds in the same continuous buffered range.
        const target = Math.max(current, end - 2);
        return { video, details: {
          currentTime: current, targetTime: target,
          skipSeconds: target - current,
          bufferSeconds: end - current,
          latencySeconds: player.getLiveLatency(),
          reserveSeconds: 2,
        } };
      }
    }
    throw new Error('Current position is outside a continuous buffered range.');
  }
  window.twitchCatchUp = Object.freeze({
    preview() { return inspect().details; },
    jump() {
      const { video, details } = inspect();
      if (details.skipSeconds < 1) return { ...details, jumped: false };
      video.currentTime = details.targetTime;
      return { ...details, jumped: true };
    },
  });
  console.log('Ready: twitchCatchUp.preview(); twitchCatchUp.jump();');
})();
