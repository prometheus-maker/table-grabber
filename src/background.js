// Toolbar button (or Alt+Shift+G): open or close the Table Grabber panel in the current tab.
// Firefox has `browser`, Chromium has `chrome`; both return promises in MV3.
const api = globalThis.browser ?? globalThis.chrome;
api.action.onClicked.addListener(async (tab) => {
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/core.js", "src/panel.js"] });
  } catch (e) {
    // pages the browser protects (about:, chrome://, add-on stores, the PDF viewer) can't run add-ons
    console.warn("Table Grabber can't run on this page:", e.message);
  }
});
