// Toolbar button (or Alt+Shift+G): open or close the Table Grabber panel in the current tab.
browser.action.onClicked.addListener(async (tab) => {
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/core.js", "src/panel.js"] });
  } catch (e) {
    // pages Firefox protects (about:, addons.mozilla.org, the PDF viewer) can't run add-ons
    console.warn("Table Grabber can't run on this page:", e.message);
  }
});
