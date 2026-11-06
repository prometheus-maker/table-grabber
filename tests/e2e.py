"""End-to-end check of the panel in headless Firefox: open, detect, crawl Next pages, download CSV + XLSX.
Run: tests/fx.sh tests/e2e.py [--shots DIR]. Exits 1 on the first failed check."""
import csv, io, pathlib, sys, zipfile, re
from playwright.sync_api import sync_playwright

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
SHOTS = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        fails.append(name)


def open_panel(pg, url):
    pg.goto(url, wait_until="load", timeout=60000)
    pg.add_script_tag(path=str(SRC / "core.js"))
    pg.add_script_tag(path=str(SRC / "panel.js"))
    pg.wait_for_function("() => globalThis.__tgPanel && globalThis.__tgPanel.state.cands.length >= 0")


def click(pg, text):
    pg.evaluate("""(t) => { const b = [...globalThis.__tgPanel.root.querySelectorAll('button')].find(b => b.textContent.includes(t));
      if (!b) throw new Error('no button ' + t); b.click(); }""", text)


def crawl(pg, pages):
    pg.evaluate("(n) => { globalThis.__tgPanel.root.querySelector('input[type=number]').value = String(n); }", pages)
    click(pg, "Get pages")
    pg.wait_for_function("() => !globalThis.__tgPanel.state.busy && globalThis.__tgPanel.state.pages > 1", timeout=90000)
    return pg.evaluate("() => ({rows: globalThis.__tgPanel.state.rows.length, pages: globalThis.__tgPanel.state.pages,"
                       " status: globalThis.__tgPanel.root.querySelector('.body > div:last-child').textContent})")


def download(pg, label):
    with pg.expect_download(timeout=20000) as d:
        click(pg, label)
    return d.value.suggested_filename, pathlib.Path(d.value.path()).read_bytes()


def xlsx_rows(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    assert z.testzip() is None
    sheet = z.read("xl/worksheets/sheet1.xml").decode()
    return re.findall(r"<row ", sheet), sheet


with sync_playwright() as p:
    b = p.firefox.launch()
    ctx = b.new_context(bypass_csp=True, accept_downloads=True, viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()

    # 1. books.toscrape.com: product grid, link-based Next (fetched pages), CSV + XLSX
    open_panel(pg, "https://books.toscrape.com/")
    st = pg.evaluate("() => { const s = globalThis.__tgPanel.state; return {n: s.rows.length, cols: s.names, kind: s.cur && s.cur.kind, next: !!s.next}; }")
    check("books: 20 products detected first", st["n"] == 20 and st["kind"] == "list", st)
    check("books: Next found", st["next"])
    if SHOTS:
        pg.screenshot(path=str(SHOTS / "books-panel.png"))
    r = crawl(pg, 3)
    check("books: 3 pages -> 60 rows", r["rows"] == 60 and r["pages"] == 3, r)
    name, data = download(pg, "CSV")
    rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    check("books: CSV has header + 60 rows", len(rows) == 61 and name.endswith(".csv"), f"{name} {len(rows)}")
    check("books: CSV row has a £ price", any("£" in c for c in rows[1]), rows[1])
    name, data = download(pg, "Excel")
    xr, sheet = xlsx_rows(data)
    check("books: XLSX opens (zip ok) with 61 rows", len(xr) == 61 and name.endswith(".xlsx"), f"{name} {len(xr)}")
    if SHOTS:
        pg.screenshot(path=str(SHOTS / "books-after-crawl.png"))

    # 2. quotes.toscrape.com: 10 quotes per page, Next link
    open_panel(pg, "https://quotes.toscrape.com/")
    r = crawl(pg, 4)
    check("quotes: 4 pages -> 40 rows", r["rows"] == 40, r)

    # 3. scrapethissite hockey table: <table> with ?page_num= pagination (its first Next points to page 1 itself)
    open_panel(pg, "https://www.scrapethissite.com/pages/forms/")
    st = pg.evaluate("() => { const s = globalThis.__tgPanel.state; return {n: s.rows.length, kind: s.cur.kind, cols: s.names.length}; }")
    check("hockey: table of 25 rows x 9+ cols", st["n"] == 25 and st["kind"] == "table" and st["cols"] >= 9, st)
    r = crawl(pg, 3)
    check("hockey: new rows from later pages", r["rows"] >= 50, r)

    # 4. webscraper.io AJAX test site: Next is a button (no page load), click mode
    open_panel(pg, "https://webscraper.io/test-sites/e-commerce/ajax/computers/laptops")
    st = pg.evaluate("() => { const s = globalThis.__tgPanel.state; return {n: s.rows.length, next: s.next}; }")
    check("ajax laptops: 6 products, Next button found", st["n"] == 6 and st["next"] is not None, st)
    r = crawl(pg, 3)
    check("ajax laptops: click-mode crawl -> 18 rows", r["rows"] == 18, r)
    if SHOTS:
        pg.screenshot(path=str(SHOTS / "ajax-after-crawl.png"))

    # 5. Toggle closes the panel
    pg.add_script_tag(path=str(SRC / "panel.js"))
    gone = pg.evaluate("() => !globalThis.__tgPanel && !document.getElementById('table-grabber-host')")
    check("second click closes the panel", gone)
    b.close()

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
