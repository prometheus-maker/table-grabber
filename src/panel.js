/* Table Grabber panel: a small window inside the page (shadow DOM, so the page's styles can't reach it).
   Clicking the toolbar button again closes it. Everything happens in this tab; nothing is sent anywhere. */
(function () {
  "use strict";
  const TG = globalThis.TableGrabber;
  if (globalThis.__tgPanel) { globalThis.__tgPanel.close(); return; }

  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const CSS_TEXT = `
    :host { all: initial; }
    .box { position: fixed; top: 12px; right: 12px; z-index: 2147483647; width: 460px; max-width: calc(100vw - 24px);
      max-height: calc(100vh - 24px); display: flex; flex-direction: column; background: #fff; color: #1f2328;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.28); border: 1px solid #e3e3e3; overflow: hidden; }
    .top { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: linear-gradient(90deg,#b8320b,#e8590c);
      color: #fff; font-weight: 600; cursor: move; user-select: none; }
    .top .t { flex: 1; } .x { background: none; border: 0; color: #fff; font-size: 18px; cursor: pointer; padding: 0 2px; }
    .body { padding: 10px 12px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
    select, input[type=number] { font: inherit; padding: 4px 6px; border: 1px solid #c9c9c9; border-radius: 6px; background: #fff; color: #1f2328; }
    select { width: 100%; }
    .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    button.b { font: inherit; padding: 6px 10px; border-radius: 6px; border: 1px solid #c9c9c9; background: #f6f6f6; color: #1f2328; cursor: pointer; }
    button.b:hover { background: #ececec; } button.b:disabled { opacity: .5; cursor: default; }
    button.p { background: #e8590c; border-color: #c94d0a; color: #fff; font-weight: 600; } button.p:hover { background: #cf4f0b; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { font-size: 12px; padding: 2px 8px; border-radius: 12px; border: 1px solid #e8590c; color: #b8320b; background: #fff4ec; cursor: pointer; }
    .chip.off { border-color: #cfcfcf; color: #8a8a8a; background: #f6f6f6; text-decoration: line-through; }
    .wrap { max-height: 240px; overflow: auto; border: 1px solid #e3e3e3; border-radius: 6px; }
    table { border-collapse: collapse; font-size: 12px; width: max-content; min-width: 100%; }
    th, td { border-bottom: 1px solid #eee; padding: 3px 6px; text-align: left; max-width: 220px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    th { position: sticky; top: 0; background: #fff4ec; font-weight: 600; outline: none; }
    th:focus { background: #ffe1cc; }
    .muted { color: #6b6b6b; font-size: 12px; } .ok { color: #1a7f37; } .warn { color: #9a6700; }
    .foot { padding: 6px 12px 9px; border-top: 1px solid #eee; color: #6b6b6b; font-size: 11px; }
  `;

  const state = { cands: [], cur: null, rows: [], on: [], names: [], next: null, nextPick: null, stop: false, busy: false, pages: 1 };
  const host = h("div", { id: "table-grabber-host" });
  const root = host.attachShadow({ mode: "closed" });
  root.append(h("style", {}, CSS_TEXT));
  let marked = null;

  const ui = {};
  ui.select = h("select", { onchange: () => choose(state.cands[+ui.select.value]) });
  ui.pick = h("button", { class: "b", title: "Click the table or list you want on the page", onclick: () => pickElement() }, "🎯 Pick on page");
  ui.chips = h("div", { class: "chips" });
  ui.wrap = h("div", { class: "wrap" });
  ui.info = h("div", { class: "muted" });
  ui.nextInfo = h("span", { class: "muted" });
  ui.pages = h("input", { type: "number", min: "2", max: "500", value: "10", style: "width:64px", title: "How many pages at most" });
  ui.go = h("button", { class: "b", onclick: () => (state.busy ? (state.stop = true) : crawl()) }, "▶ Get pages");
  ui.pickNext = h("button", { class: "b", title: "Click the site's “Next” button or link", onclick: () => pickNext() }, "Pick “Next”");
  ui.csv = h("button", { class: "b p", onclick: () => download("csv") }, "⬇ CSV");
  ui.xlsx = h("button", { class: "b p", onclick: () => download("xlsx") }, "⬇ Excel");
  ui.copy = h("button", { class: "b", onclick: () => copy() }, "📋 Copy");
  ui.status = h("div", { class: "muted" });

  const box = h("div", { class: "box" },
    h("div", { class: "top" }, h("span", { class: "t" }, "🔥 Table Grabber"),
      h("button", { class: "x", title: "Close", onclick: () => close() }, "×")),
    h("div", { class: "body" },
      h("div", { class: "row" }, ui.select), h("div", { class: "row" }, ui.pick, ui.info),
      ui.chips, ui.wrap,
      h("div", { class: "row" }, h("b", {}, "More pages:"), ui.nextInfo),
      h("div", { class: "row" }, ui.pickNext, "up to", ui.pages, "pages", ui.go),
      h("div", { class: "row" }, ui.csv, ui.xlsx, ui.copy), ui.status),
    h("div", { class: "foot" }, "Runs only in this tab when you click it. No account, no tracking; nothing leaves your browser."));
  root.append(box);
  document.documentElement.append(host);
  drag(box, box.querySelector(".top"));

  function mark(el) {
    if (marked) { marked.el.style.outline = marked.outline; marked.el.style.outlineOffset = marked.offset; }
    marked = el ? { el, outline: el.style.outline, offset: el.style.outlineOffset } : null;
    if (el) { el.style.outline = "3px dashed #e8590c"; el.style.outlineOffset = "2px"; }
  }

  function label(c, i) {
    const kind = c.kind === "table" ? "Table" : "List";
    const cols = c.columns.filter((_, j) => !(c.hidden || [])[j]).length;
    const first = c.rows[0] ? c.rows[0].find((v) => v && !/^https?:/.test(v)) || "" : "";
    return `${i + 1}. ${kind} · ${c.rows.length} rows × ${cols} columns${first ? " · " + first.slice(0, 40) : ""}`;
  }

  function scan() {
    state.cands = TG.detect(document, { max: 12 });
    ui.select.replaceChildren(...state.cands.map((c, i) => h("option", { value: String(i) }, label(c, i))));
    if (!state.cands.length) {
      ui.info.textContent = "No table or repeating list found here. Scroll to load the content, then click the button again.";
      choose(null);
      return;
    }
    choose(state.cands[0]);
  }

  function choose(c) {
    state.cur = c;
    state.rows = c ? c.rows.slice() : [];
    state.names = c ? c.columns.slice() : [];
    state.on = c ? c.columns.map((_, i) => !(c.hidden || [])[i]) : [];
    state.pages = 1;
    if (c) {
      ui.select.value = String(state.cands.indexOf(c));
      mark(c.el);
      c.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else mark(null);
    state.next = TG.findNext(document);
    state.nextPick = null;
    render();
  }

  function render() {
    const c = state.cur;
    ui.chips.replaceChildren(...state.names.map((n, i) => h("span", {
      class: "chip" + (state.on[i] ? "" : " off"), title: state.on[i] ? "Click to leave this column out" : "Click to include this column",
      onclick: () => { state.on[i] = !state.on[i]; render(); } }, n)));
    const idx = state.names.map((_, i) => i).filter((i) => state.on[i]);
    const head = h("tr", {}, idx.map((i) => {
      const th = h("th", { contenteditable: "true", title: "Click to rename" }, state.names[i]);
      th.addEventListener("input", () => { state.names[i] = th.textContent.trim() || `Column ${i + 1}`; });
      th.addEventListener("blur", () => render());
      return th;
    }));
    const body = state.rows.slice(0, 100).map((r) => h("tr", {}, idx.map((i) => h("td", { title: r[i] || "" }, r[i] || ""))));
    ui.wrap.replaceChildren(h("table", {}, h("thead", {}, head), h("tbody", {}, body)));
    ui.info.textContent = c ? `${state.rows.length} rows${state.pages > 1 ? ` from ${state.pages} pages` : ""}${state.rows.length > 100 ? " (preview shows 100)" : ""}` : "";
    const nx = state.nextPick || state.next;
    ui.nextInfo.textContent = nx ? `“Next” found (${(nx.label || "next").slice(0, 20)})` : "no “Next” found; pick it if the site has one";
    ui.nextInfo.className = nx ? "ok" : "muted";
    ui.go.disabled = !c || (!nx && !state.busy);
    for (const b of [ui.csv, ui.xlsx, ui.copy]) b.disabled = !c || !state.rows.length || state.busy;
  }

  function exportData() {
    const idx = state.names.map((_, i) => i).filter((i) => state.on[i]);
    return { columns: idx.map((i) => state.names[i]), rows: state.rows.map((r) => idx.map((i) => r[i] || "")) };
  }

  function fileName(ext) {
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    const host = (location.hostname || "page").replace(/^www\./, "").replace(/[^\w.-]+/g, "-");
    return `${host}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ext}`;
  }

  function download(kind) {
    const { columns, rows } = exportData();
    const blob = kind === "csv"
      ? new Blob([TG.toCSV(columns, rows)], { type: "text/csv;charset=utf-8" })
      : new Blob([TG.toXLSX(columns, rows, location.hostname || "Data")], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: fileName(kind), style: "display:none" });
    root.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    say(`Saved ${rows.length} rows as ${fileName(kind)}`, "ok");
  }

  async function copy() {
    const { columns, rows } = exportData();
    const text = TG.toTSV(columns, rows);
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = h("textarea", { style: "position:fixed;left:-9999px" });
      ta.value = text;
      root.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    say(`Copied ${rows.length} rows: paste into Excel or Google Sheets`, "ok");
  }

  function say(msg, cls = "muted") { ui.status.textContent = msg; ui.status.className = cls; }

  // Wait for the user's next click on the page and hand over the element (Esc cancels).
  function capture(prompt) {
    return new Promise((resolve) => {
      say(prompt + " (Esc cancels)", "warn");
      let last = null;
      const over = (e) => { if (host.contains(e.target)) return; if (last) last.style.boxShadow = last.__tgShadow || ""; last = e.target;
        last.__tgShadow = last.style.boxShadow; last.style.boxShadow = "0 0 0 2px #e8590c inset"; };
      const done = (el) => {
        document.removeEventListener("mouseover", over, true);
        document.removeEventListener("click", click, true);
        document.removeEventListener("keydown", key, true);
        if (last) last.style.boxShadow = last.__tgShadow || "";
        resolve(el);
      };
      const click = (e) => { if (host.contains(e.target)) return; e.preventDefault(); e.stopPropagation(); done(e.target); };
      const key = (e) => { if (e.key === "Escape") { e.preventDefault(); say(""); done(null); } };
      document.addEventListener("mouseover", over, true);
      document.addEventListener("click", click, true);
      document.addEventListener("keydown", key, true);
    });
  }

  async function pickElement() {
    const el = await capture("Click inside the table or list you want");
    if (!el) return;
    const all = TG.detect(document, { max: 40 });
    const hits = all.filter((c) => c.el.contains(el)).sort((a, b) => (a.el.contains(b.el) ? 1 : b.el.contains(a.el) ? -1 : b.score - a.score));
    if (!hits.length) { say("Nothing list-like around that spot. Try clicking on one of the rows.", "warn"); return; }
    state.cands = [hits[0], ...state.cands.filter((c) => c.el !== hits[0].el)];
    ui.select.replaceChildren(...state.cands.map((c, i) => h("option", { value: String(i) }, label(c, i))));
    choose(state.cands[0]);
    say("Picked.", "ok");
  }

  async function pickNext() {
    const el = await capture("Click the site's “Next” button or link");
    if (!el) return;
    const target = el.closest("a, button, [role='button'], input") || el;
    const href = target.tagName === "A" && target.getAttribute("href") && !/^\s*(javascript:|#\s*$)/i.test(target.getAttribute("href")) ? target.href : null;
    state.nextPick = { href, selector: TG.selectorFor(target), label: TG.clean(target.textContent || target.value || target.getAttribute("aria-label") || "next") };
    render();
    say("Got it. Now press “Get pages”.", "ok");
  }

  // The "Next" on another page: the picked element's selector, else one with the same label, else auto-detect.
  function nextIn(doc) {
    const p = state.nextPick;
    if (p) {
      let el = null;
      try { el = p.selector && doc.querySelector(p.selector); } catch (e) { el = null; }
      if (!el || TG.clean(el.textContent || el.value || el.getAttribute("aria-label") || "") !== p.label) {
        el = [...doc.querySelectorAll("a, button, [role='button']")].find((x) =>
          TG.clean(x.textContent || x.getAttribute("aria-label") || "") === p.label) || el;
      }
      if (!el) return null;
      const href = el.tagName === "A" && el.getAttribute("href") && !/^\s*(javascript:|#\s*$)/i.test(el.getAttribute("href")) ? el.href : null;
      return { href, selector: TG.selectorFor(el), label: p.label };
    }
    return TG.findNext(doc);
  }

  async function crawl() {
    const c = state.cur;
    if (!c) return;
    state.busy = true; state.stop = false;
    ui.go.textContent = "■ Stop";
    render(); ui.go.disabled = false;
    const max = Math.max(2, Math.min(500, parseInt(ui.pages.value, 10) || 10));
    const seen = new Set(state.rows.map((r) => JSON.stringify(r)));
    const visited = new Set([location.href.split("#")[0]]);
    let nx = state.nextPick || state.next, empty = 0, why = "";
    while (state.pages < max && !state.stop) {
      if (!nx) { why = "no more “Next”"; break; }
      let res = null;
      if (nx.href) {
        const url = nx.href.split("#")[0];
        if (visited.has(url)) { why = "the next page was already read"; break; }
        visited.add(url);
        say(`Reading page ${state.pages + 1}…`);
        await sleep(900); // be gentle with the site
        let doc;
        try {
          const r = await fetch(url, { credentials: "include" });
          if (!r.ok) { why = `the site answered ${r.status}`; break; }
          doc = new DOMParser().parseFromString(await r.text(), "text/html");
          const base = doc.createElement("base");
          base.href = url;
          doc.head.prepend(base);
        } catch (e) { why = "the next page could not be loaded"; break; }
        res = TG.extractLike(doc, c);
        if (!res) { why = "the next page has no matching data (the site may build it with scripts)"; break; }
        nx = nextIn(doc);
      } else {
        const el = document.querySelector(nx.selector);
        if (!el) { why = "the “Next” button is gone"; break; }
        const before = JSON.stringify((TG.extractLike(document, c) || { rows: [] }).rows.slice(0, 3));
        say(`Loading page ${state.pages + 1}…`);
        el.click();
        for (let t = 0; t < 40 && !state.stop; t++) {
          await sleep(300);
          const now = TG.extractLike(document, c);
          if (now && JSON.stringify(now.rows.slice(0, 3)) !== before) { res = now; break; }
        }
        if (!res) { why = "nothing changed after clicking “Next”"; break; }
        await sleep(600); // let the rest of the page arrive
        res = TG.extractLike(document, c) || res;
        nx = nextIn(document);
      }
      state.pages++;
      let added = 0;
      for (const r of res.rows) {
        const k = JSON.stringify(r);
        if (!seen.has(k)) { seen.add(k); state.rows.push(r); added++; }
      }
      empty = added ? 0 : empty + 1;
      render(); ui.go.disabled = false;
      if (empty >= 2) { why = "two pages in a row had nothing new"; break; }
    }
    state.busy = false;
    ui.go.textContent = "▶ Get pages";
    render();
    say(`${state.rows.length} rows from ${state.pages} pages${state.stop ? " (stopped)" : why ? ": stopped because " + why : ""}.`, "ok");
  }

  function drag(el, handle) {
    let sx, sy, ox, oy;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      const r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      const move = (m) => { el.style.left = Math.max(0, ox + m.clientX - sx) + "px"; el.style.top = Math.max(0, oy + m.clientY - sy) + "px"; el.style.right = "auto"; };
      const up = () => { document.removeEventListener("mousemove", move, true); document.removeEventListener("mouseup", up, true); };
      document.addEventListener("mousemove", move, true);
      document.addEventListener("mouseup", up, true);
      e.preventDefault();
    });
  }

  function close() {
    state.stop = true;
    mark(null);
    host.remove();
    delete globalThis.__tgPanel;
  }

  globalThis.__tgPanel = { close, state, root, scan };
  scan();
})();
