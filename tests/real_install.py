"""Install the packed add-on into a real Firefox (geckodriver), press its toolbar button, use the panel with real
mouse clicks, and check the files it downloads. Run: tests/real.sh (sets the library path and builds the .xpi)."""
import csv, io, pathlib, sys, time, zipfile
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

HOME = pathlib.Path.home()
XPI, DL, SHOTS = sys.argv[1], pathlib.Path("/tmp/tg-dl"), pathlib.Path("/tmp/tgshots")
WIDGET = "table-grabber_prometheus-maker_github_io-browser-action"
fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        fails.append(name)


for f in DL.glob("*"):
    f.unlink()
DL.mkdir(exist_ok=True)
SHOTS.mkdir(exist_ok=True)
o = Options()
o.binary_location = str(HOME / ".local/firefox-real/firefox/firefox")
o.add_argument("-headless")

for k, v in {"browser.download.dir": str(DL), "browser.download.folderList": 2, "browser.download.useDownloadDir": True,
             "browser.download.always_ask_before_handling_new_types": False,
             "browser.helperApps.neverAsk.saveToDisk": "text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}.items():
    o.set_preference(k, v)
d = webdriver.Firefox(options=o, service=Service(str(HOME / ".local/firefox-real/geckodriver"), service_args=["--allow-system-access"]))
try:
    d.set_window_size(1280, 900)
    d.install_addon(XPI, temporary=True)
    d.get("https://books.toscrape.com/")

    def press_button():
        d.set_context(d.CONTEXT_CHROME)
        try:
            return d.execute_script("""
              const id = arguments[0];
              if (!window.CustomizableUI) return 'not chrome: ' + window.location.href + ' ' + typeof ChromeUtils;
              const CustomizableUI = window.CustomizableUI, document = window.document;
              CustomizableUI.addWidgetToArea(id, CustomizableUI.AREA_NAVBAR);
              const node = document.getElementById(id);
              if (!node) return 'no widget';
              const btn = node.querySelector('toolbarbutton') || node;
              btn.click();
              return 'clicked ' + btn.tagName;""", WIDGET)
        finally:
            d.set_context(d.CONTEXT_CONTENT)

    r = press_button()
    check("toolbar button found and pressed", r.startswith("clicked"), r)
    time.sleep(2)
    host = d.execute_script("return !!document.getElementById('table-grabber-host')")
    check("panel opened in the page", host)
    d.save_screenshot(str(SHOTS / "real-open.png"))

    # The panel is a closed shadow root: use real mouse clicks at the button positions (panel is fixed top-right).
    def click_at(x, y):
        a = ActionChains(d)
        a.w3c_actions.pointer_action.move_to_location(x, y)
        a.w3c_actions.pointer_action.click()
        a.perform()

    click_at(852, 527)  # ⬇ CSV
    time.sleep(3)
    files = list(DL.glob("*.csv"))
    rows = list(csv.reader(io.StringIO(files[0].read_text("utf-8-sig")))) if files else []
    check("CSV downloaded from the real add-on", len(rows) == 21, f"{[f.name for f in DL.iterdir()]} rows={len(rows)}")
    click_at(1140, 488)  # ▶ Get pages (default 10 pages)
    time.sleep(25)
    d.save_screenshot(str(SHOTS / "real-crawl.png"))
    click_at(928, 527)  # ⬇ Excel
    time.sleep(3)
    x = list(DL.glob("*.xlsx"))
    n = zipfile.ZipFile(x[0]).read("xl/worksheets/sheet1.xml").decode().count("<row ") if x else 0
    check("Excel after crawling 10 pages has 201 rows", n == 201, f"{[f.name for f in DL.iterdir()]} rows={n}")
    r = press_button()
    time.sleep(1)
    check("second press closes the panel", not d.execute_script("return !!document.getElementById('table-grabber-host')"))
finally:
    d.quit()
print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
