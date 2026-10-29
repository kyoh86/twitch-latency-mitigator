(() => {
  // Avoid duplicate controls/timers if injected twice during development.
  window.twitchLatencyMitigator?.destroy();
  // English until the extension's localized strings arrive from the isolated world.
  const messages = {
    followLabel: 'Follow live', followOff: 'Turn OFF before rewinding.',
    following: 'Following live', waitingPlayback: 'Waiting for playback',
    waitingLive: 'Waiting for live video to follow', jumped: 'Skipped ahead {seconds} seconds',
    followHelp: 'When ON, parts of the video may be skipped to follow live. Turn OFF before rewinding.',
  };
  let enabled = false;
  let defaultEnabled = false;
  let settingsLoaded = false;
  let manuallyChanged = false;
  let lastJump = -Infinity;
  let lastPath = location.pathname;
  let messageKey = 'followOff';
  let skippedSeconds = '';
  const host = document.createElement('div');
  host.id = 'twitch-latency-mitigator';
  host.style.cssText = 'display:inline-flex;align-items:center;flex:none;margin:0 4px';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host{font:12px/1.4 system-ui,sans-serif;color:white}
    div{display:flex;align-items:center}
    button{font:inherit;font-weight:600;white-space:nowrap;color:white;background:transparent;border:0;border-radius:4px;padding:5px 6px;cursor:pointer}
    button:hover{background:rgba(255,255,255,.2)}
    button[aria-pressed="true"]{color:#bf94ff}
    button:focus-visible{outline:2px solid white;outline-offset:2px}
    span{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  `;
  const panel = document.createElement('div');
  const button = document.createElement('button');
  button.type = 'button';

  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  panel.append(button, status);
  shadow.append(style, panel);
  function render() {
    button.textContent = `${messages.followLabel}: ${enabled ? 'ON' : 'OFF'}`;
    const message = messages[messageKey].replace('{seconds}', skippedSeconds);
    button.setAttribute('aria-pressed', String(enabled));
    if (status.textContent !== message) status.textContent = message;
    button.title = `${message} ${messages.followHelp}`;
  }
  function tick() {
    if (lastPath !== location.pathname) {
      // New pages use the preference, not the previous page’s manual override.
      enabled = defaultEnabled;
      manuallyChanged = false;
      lastJump = -Infinity;
      lastPath = location.pathname;
      messageKey = enabled ? 'following' : 'followOff';
    }
    const root = document.querySelector('.video-player');
    const controls = root?.querySelector('.player-controls__right-control-group');
    if (controls && host.parentElement !== controls) controls.prepend(host);
    if (!controls) host.remove();
    if (enabled) {
      const video = root?.querySelector('video');
      if (!video || video.paused || video.seeking || video.readyState < 3) {
        messageKey = 'waitingPlayback';
      } else {
        try {
          const plan = window.twitchCatchUp.preview();
          if (plan.skipSeconds >= 5 && performance.now() - lastJump >= 5000) {
            const result = window.twitchCatchUp.jump();
            if (result.jumped) {
              lastJump = performance.now();
              skippedSeconds = result.skipSeconds.toFixed(1);
              messageKey = 'jumped';
            }
          } else if (performance.now() - lastJump >= 5000) {
            messageKey = 'following';
          }
        } catch {
          messageKey = 'waitingLive';
        }
      }
    }
    render();
  }
  button.addEventListener('click', () => {
    manuallyChanged = true;
    enabled = !enabled;
    lastJump = -Infinity;
    messageKey = enabled ? 'following' : 'followOff';
    tick();
  });
  function onSettings(event) {
    if (event.source !== window || event.origin !== location.origin ||
        event.data?.source !== 'twitch-latency-mitigator-settings' ||
        typeof event.data.defaultEnabled !== 'boolean') return;
    for (const key of Object.keys(messages)) {
      const value = event.data.messages?.[key];
      if (typeof value === 'string' && value.length > 0 && value.length <= 2000) messages[key] = value;
    }
    defaultEnabled = event.data.defaultEnabled;
    // Preference edits affect future pages, not the current manual selection.
    if (!settingsLoaded && !manuallyChanged) {
      enabled = defaultEnabled;
      messageKey = enabled ? 'following' : 'followOff';
    }
    settingsLoaded = true;
    tick();
  }
  window.addEventListener('message', onSettings);
  window.postMessage({ source: 'twitch-latency-mitigator', type: 'request-settings' }, location.origin);
  const interval = setInterval(tick, 1000);
  window.twitchLatencyMitigator = Object.freeze({
    destroy() {
      clearInterval(interval);
      window.removeEventListener('message', onSettings);
      host.remove();
    },
  });
  tick();
})();
