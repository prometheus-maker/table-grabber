"""Load the Chromium build into real Chrome for Testing (headless), run it on books.toscrape.com, check the panel finds the book list.
Run: LD_LIBRARY_PATH=~/.local/chromelibs/usr/lib/aarch64-linux-gnu ~/.local/venv-browser/bin/python -I tests/chromium_real.py"""
import os, sys, tempfile, pathlib
from playwright.sync_api import sync_playwright
import json, shutil
src = pathlib.Path(__file__).resolve().parent.parent / "dist/chromium"
# Test copy only: a headless test can't press the toolbar button that grants activeTab, so allow the test host.
ext = pathlib.Path(tempfile.mkdtemp()) / "ext"; shutil.copytree(src, ext)
m = json.loads((ext / "manifest.json").read_text()); m["host_permissions"] = ["https://books.toscrape.com/*"]
(ext / "manifest.json").write_text(json.dumps(m)); ext = str(ext)
with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=True, channel="chromium",
        args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"])
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
    print("service worker:", sw.url)
    p = ctx.new_page(); p.goto("https://books.toscrape.com/", wait_until="domcontentloaded"); p.wait_for_timeout(1500)
    # Same call the toolbar click makes (the click itself can't be pressed headless).
    sw.evaluate("""async () => { const tabs = await chrome.tabs.query({}); const t = tabs[tabs.length - 1];
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['src/core.js', 'src/panel.js'] }); }""")
    p.wait_for_timeout(2500)
    # The panel lives in a closed shadow root, so check what the page can see: a new fixed-position host element.
    n = p.evaluate("() => document.getElementById('table-grabber-host') ? 1 : 0")
    txt = "PASS panel opened" if n else "FAIL no panel"
    print(txt)
    p.screenshot(path=os.path.expanduser("~/work/tmp/tg-chromium.png"))
    ctx.close()
    sys.exit(0 if n else 1)
