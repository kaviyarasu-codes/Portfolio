// Right-click menu: open the full Site Audit for the current page.
const AUDIT_URL = 'https://kaviyarasu-portfolio.pages.dev/site-audit';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'full-audit', title: 'Full Site Audit of this website', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'full-audit' || !tab?.url || !/^https?:/.test(tab.url)) return;
  chrome.tabs.create({ url: `${AUDIT_URL}?url=${encodeURIComponent(tab.url)}` });
});
