// Paste into the Twitch channel page's DevTools console, then call run().
// Each run changes this page temporarily and reloads it after printing results.
(() => {
  let running = false;
  function findPlayer(video) {
    let fiber;
    for (let node = video; node && !fiber; node = node.parentElement) {
      const key = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
      if (key) fiber = node[key];
    }
    for (let node = fiber, i = 0; node && i < 60; node = node.return, i++) {
      const wrapper = node.memoizedProps?.mediaPlayerInstance;
      const core = wrapper?.playerInstance?.core;
      if (core?.getLiveLatency && core?.configManager) return core;
    }
    throw new Error('Twitch private player API not found.');
  }
  window.twitchNativeControlExperiment = Object.freeze({
    async run({ mode = 'speedUp', rewindSeconds = 0 } = {}) {
      if (running) throw new Error('An experiment is already running.');
      if (!['speedUp', 'maxLatency', 'enabledFlag'].includes(mode)) {
        throw new Error('Unknown experiment mode.');
      }
      if (!Number.isFinite(rewindSeconds) || rewindSeconds < 0 || rewindSeconds > 5) {
        throw new RangeError('rewindSeconds must be from 0 to 5.');
      }
      const video = document.querySelector('video');
      if (!video || video.paused || video.readyState < 3) {
        throw new Error('A playing video is required.');
      }
      const player = findPlayer(video);
      if (!player.isLiveLowLatency() || player.getDuration() !== Infinity) {
        throw new Error('A low-latency live stream is required.');
      }
      if (document.querySelector('[data-a-target="video-ad-label"]')) {
        throw new Error('Wait for the advertisement to finish.');
      }
      // Label absence alone cannot establish that an ad is not playing.
      if (rewindSeconds && !Array.from({ length: video.buffered.length }, (_, i) => i)
        .some(i => video.buffered.start(i) <= video.currentTime - rewindSeconds &&
          video.buffered.end(i) >= video.currentTime)) {
        throw new Error('Not enough buffered history for the requested rewind.');
      }
      const manager = player.configManager;
      const originalBufferControl = structuredClone(manager.getConfigSnapshot().bufferControl);
      const result = { mode, rewindSeconds, originalBufferControl, rows: [], errors: [] };
      const onError = event => result.errors.push({
        message: event?.message, code: event?.code, source: event?.source,
      });
      const snapshot = phase => result.rows.push({
        phase, at: new Date().toISOString(), elapsedSeconds: (performance.now() - start) / 1000,
        latencySeconds: player.getLiveLatency(), bufferSeconds: player.getBufferDuration(),
        playerRate: player.getPlaybackRate(), videoRate: video.playbackRate,
        currentTime: video.currentTime, state: player.getState(),
        enabled: manager.getConfigSnapshot().bufferControl.liveCatchUpSpeedUpEnabled,
      });
      const start = performance.now();
      const sample = async (phase, count) => {
        for (let i = 0; i < count; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (!video.isConnected || video.paused || video.readyState < 3 ||
              player.getBufferDuration() < 1 ||
              document.querySelector('[data-a-target="video-ad-label"]')) {
            throw new Error('Playback changed or buffer became too small; stopping.');
          }
          snapshot(phase);
          if (result.errors.length) break;
        }
      };
      running = true;
      player.addEventListener('PlayerWorkerError', onError);
      try {
        snapshot('before');
        if (rewindSeconds) video.currentTime -= rewindSeconds;
        await sample('baseline', 5);
        if (mode === 'speedUp') player.setLiveSpeedUpRate(1.1);
        if (mode === 'maxLatency') player.setLiveMaxLatency(3);
        if (mode === 'enabledFlag') {
          manager.updateLoadConfig({ bufferControl: { liveCatchUpSpeedUpEnabled: false } });
        }
        await sample('changed', 10);
      } catch (error) {
        result.stopped = String(error);
      } finally {
        try {
          if (mode === 'enabledFlag') {
            manager.updateLoadConfig({ bufferControl: originalBufferControl });
          }
        } finally {
          player.removeEventListener('PlayerWorkerError', onError);
          running = false;
          console.table(result.rows);
          console.log(JSON.stringify(result));
          // No getter for speed-up/max-latency settings: recreate the player.
          setTimeout(() => location.reload(), 3000);
        }
      }
      return result;
    },
  });
  console.log('Ready: await twitchNativeControlExperiment.run({mode: "speedUp", rewindSeconds: 4})');
})();
