(() => {
  const t = key => chrome.i18n.getMessage(key);
  document.documentElement.lang = chrome.i18n.getUILanguage().startsWith('ja') ? 'ja' : 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  const checkbox = document.getElementById('default-enabled');
  const status = document.getElementById('status');
  chrome.storage.local.get({ defaultEnabled: false }).then(settings => {
    checkbox.checked = settings.defaultEnabled === true;
    checkbox.disabled = false;
  }).catch(() => { status.textContent = t('loadError'); });
  checkbox.addEventListener('change', async () => {
    checkbox.disabled = true;
    status.textContent = t('saving');
    const selected = checkbox.checked;
    try {
      await chrome.storage.local.set({ defaultEnabled: selected });
      status.textContent = t('saved');
    } catch {
      checkbox.checked = !selected;
      status.textContent = t('saveError');
    } finally {
      checkbox.disabled = false;
    }
  });
})();
