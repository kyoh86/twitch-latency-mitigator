// Extension APIs stay isolated; only the preference and UI strings reach the page.
(() => {
  const messages = Object.fromEntries([
    'followLabel', 'followOff', 'following', 'waitingPlayback', 'waitingLive', 'jumped', 'followHelp',
  ].map(key => [key, chrome.i18n.getMessage(key, key === 'jumped' ? '{seconds}' : undefined)]));
  let revision = 0;
  let defaultEnabled = false;
  let ready = false;
  const send = () => window.postMessage({
    source: 'twitch-latency-mitigator-settings', defaultEnabled, messages,
  }, location.origin);
  window.addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin &&
        event.data?.source === 'twitch-latency-mitigator' &&
        event.data.type === 'request-settings' && ready) send();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.defaultEnabled) return;
    revision++;
    ready = true;
    defaultEnabled = changes.defaultEnabled.newValue === true;
    send();
  });
  const initialRevision = revision;
  chrome.storage.local.get({ defaultEnabled: false }).then(settings => {
    if (revision !== initialRevision) return;
    defaultEnabled = settings.defaultEnabled === true;
    ready = true;
    send();
  }).catch(() => { ready = true; send(); });
})();
