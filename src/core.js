/* Table Grabber core: find the tables and repeating lists on a page, turn them into rows, write CSV and XLSX.
   Pure functions over a Document, so they also run on pages fetched for "next page" (DOMParser) and in tests.
   No network, no storage, no analytics. */
(function (root) {
  "use strict";
  if (root.TableGrabber) return;

  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "IFRAME", "OBJECT", "SELECT", "OPTION"]);
  const INLINE = new Set(["A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "CODE", "DATA", "DFN", "EM", "I", "KBD", "MARK", "Q",
    "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "WBR", "DEL", "INS", "FONT"]);
  const NEXT_RE = /^\s*(next|next page|next ›|next »|more|older posts?|weiter|nächste|suivant|siguiente|successivo|próxima|volgende|następna|sljedeća|следующая|›|»|>|→|>>)\s*$/i;

  const clean = (s) => (s || "").replace(/[\s ​]+/g, " ").trim();
  const BLOCK = /^(BR|P|DIV|LI|TR|H[1-6]|UL|OL|DL|DT|DD|SECTION|ARTICLE|HEADER|FOOTER|BLOCKQUOTE|PRE|TABLE)$/;
  // textContent, but <br> and block edges become spaces ("rate<br>in 2026" -> "rate in 2026"); hidden helper text skipped
  function txt(el) {
    let out = "";
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.textContent;
        else if (c.nodeType === 1) {
          const t = c.tagName.toUpperCase();
          if (SKIP.has(t) || c.hidden || (c.getAttribute("style") || "").replace(/\s/g, "").includes("display:none")) continue;
          if (BLOCK.test(t)) out += " ";
          walk(c);
          if (BLOCK.test(t)) out += " ";
        }
      }
    };
    walk(el);
    return clean(out);
  }
  const sig = (el) => el.tagName + (el.classList && el.classList.length ? "." + [...el.classList].sort().join(".") : "");
  const step = (el) => el.tagName.toLowerCase() + (el.classList && el.classList.length ? "." + el.classList[0] : "");

  function humanize(path) {
    const attr = path.includes("@") ? path.split("@")[1] : "";
    const last = path.split("@")[0].split(">").pop() || "";
    const [tag, cls] = last.split(".");
    const hashed = (c) => !c || /__|^css-|^sc-|[A-Za-z]*\d[A-Za-z\d]*[A-Za-z]{1}\b|[A-Z]{3,}\d/.test(c) && !/^(h\d|col-\w+-\d+)$/.test(c);
    let name = cls && !hashed(cls) ? cls.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2") : ({
      h1: "Title", h2: "Title", h3: "Title", h4: "Title", h5: "Title", h6: "Title", a: "Link text", img: "Image",
      time: "Date", p: "Text", span: "Text", li: "Item", td: "Cell", strong: "Text", b: "Text", em: "Text"
    }[tag] || tag || "Value");
    if (attr === "href") name = cls && !hashed(cls) ? name + " link" : "Link";
    if (attr === "src") name = cls && !hashed(cls) ? name + " image" : "Image";
    if (attr === "class") name = name + " (class)";
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function uniqueNames(names) {
    const seen = new Map();
    return names.map((n) => {
      const k = (seen.get(n) || 0) + 1;
      seen.set(n, k);
      return k === 1 ? n : `${n} ${k}`;
    });
  }

  // A CSS selector for el that should find the same element on the next page of the same site.
  function selectorFor(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e.tagName !== "HTML"; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id) && !/\d{3,}/.test(e.id)) {
        parts.unshift("#" + CSS.escape(e.id));
        break;
      }
      let s = e.tagName.toLowerCase();
      const cls = [...(e.classList || [])].filter((c) => /^[A-Za-z_-][\w-]*$/.test(c) && !/\d{3,}/.test(c)).slice(0, 3);
      if (cls.length) s += "." + cls.map((c) => CSS.escape(c)).join(".");
      const p = e.parentElement;
      if (p) {
        const same = [...p.children].filter((c) => c.tagName === e.tagName && cls.every((k) => c.classList.contains(k)));
        if (same.length > 1) s += `:nth-of-type(${[...p.children].filter((c) => c.tagName === e.tagName).indexOf(e) + 1})`;
      }
      parts.unshift(s);
    }
    return parts.join(" > ");
  }

  /* ---------- <table> ---------- */
  function tableRows(table) {
    const grid = [];
    const spans = []; // rowspan carry-over: spans[col] = {left, text}
    const rows = [...table.rows].filter((r) => r.closest("table") === table);
    rows.forEach((tr) => {
      const out = [];
      let col = 0;
      const take = () => {
        while (spans[col] && spans[col].left > 0) {
          out[col] = spans[col].text;
          spans[col].left--;
          col++;
        }
      };
      for (const cell of tr.cells) {
        take();
        const text = txt(cell);
        const cs = Math.min(Math.max(parseInt(cell.getAttribute("colspan") || "1", 10) || 1, 1), 50);
        const rs = Math.min(Math.max(parseInt(cell.getAttribute("rowspan") || "1", 10) || 1, 1), 500);
        for (let k = 0; k < cs; k++) {
          out[col] = k === 0 ? text : "";
          if (rs > 1) spans[col] = { left: rs - 1, text: k === 0 ? text : "" };
          col++;
        }
      }
      take();
      grid.push(out.map((v) => v || ""));
    });
    const width = Math.max(0, ...grid.map((r) => r.length));
    grid.forEach((r) => { while (r.length < width) r.push(""); });
    let header = null;
    const first = rows[0];
    if (first && (first.parentElement.tagName === "THEAD" || [...first.cells].every((c) => c.tagName === "TH"))) {
      header = grid.shift();
    }
    const names = uniqueNames((header || []).map((h, i) => h || `Column ${i + 1}`).concat(
      Array.from({ length: Math.max(0, width - (header ? header.length : 0)) }, (_, i) => `Column ${(header ? header.length : 0) + i + 1}`)));
    // a column whose cells are mostly links gets a URL column next to it
    const bodyRows = rows.slice(header ? 1 : 0);
    const linkCols = [];
    for (let c = 0; c < width; c++) {
      let n = 0;
      bodyRows.forEach((tr) => { const cell = cellAt(tr, c); if (cell && cell.querySelector("a[href]")) n++; });
      if (bodyRows.length && n >= 0.5 * bodyRows.length) linkCols.push(c);
    }
    if (!linkCols.length) return { columns: names, rows: grid };
    const cols = [], data = grid.map(() => []);
    for (let c = 0; c < width; c++) {
      cols.push(names[c]);
      grid.forEach((r, i) => data[i].push(r[c]));
      if (linkCols.includes(c)) {
        cols.push(names[c] + " link");
        bodyRows.forEach((tr, i) => { const a = cellAt(tr, c) && cellAt(tr, c).querySelector("a[href]"); data[i].push(a ? a.href : ""); });
      }
    }
    return { columns: uniqueNames(cols), rows: data };
  }

  function cellAt(tr, col) {
    let c = 0;
    for (const cell of tr.cells) {
      const cs = parseInt(cell.getAttribute("colspan") || "1", 10) || 1;
      if (col < c + cs) return cell;
      c += cs;
    }
    return null;
  }

  /* ---------- repeating lists (cards, search results, product grids) ---------- */
  function itemValues(item) {
    const vals = []; // [path, value]
    const walk = (el, path) => {
      for (const ch of el.children) {
        if (SKIP.has(ch.tagName.toUpperCase())) continue;
        const p = path ? path + ">" + step(ch) : step(ch);
        visit(ch, p);
      }
    };
    const visit = (el, p) => {
      const tag = el.tagName.toUpperCase();
      if (tag === "A" && el.getAttribute("href") && !/^\s*(javascript:|#)/i.test(el.getAttribute("href"))) vals.push([p + "@href", el.href]);
      if (tag === "IMG") {
        const src = el.currentSrc || el.getAttribute("src") || el.getAttribute("data-src") || "";
        if (src && !src.startsWith("data:")) vals.push([p + "@src", new URL(src, el.baseURI).href]);
        return;
      }
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const desc = [...el.querySelectorAll("*")];
      // one cell for "<p>Price: <b>£5</b></p>", but separate fields for "<strong>Capital:</strong> <span class=capital>"
      const allInline = desc.every((d) => INLINE.has(d.tagName.toUpperCase()) && !(d.tagName === "A" && d !== el)) &&
        desc.filter((d) => d.classList && d.classList.length && clean(d.textContent)).length < 2;
      if (own || (allInline && el.children.length && clean(el.textContent))) {
        if (allInline) {
          let t = txt(el);
          const full = clean(el.getAttribute("title") || (el.querySelector("a[title]") || { getAttribute: () => "" }).getAttribute("title"));
          if (/(\.\.\.|…)$/.test(t) && full.startsWith(t.replace(/\s*(\.\.\.|…)$/, ""))) t = full; // "A Light in the ..."
          if (t) vals.push([p, t]);
          el.querySelectorAll("a[href]").forEach((a) => {
            if (!/^\s*(javascript:|#)/i.test(a.getAttribute("href"))) vals.push([p + ">a@href", a.href]);
          });
          return;
        }
        const t = clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
        if (t) vals.push([p, t]);
      } else if (el.classList && el.classList.length > 1 && !clean(el.textContent)) {
        vals.push([p + "@class", [...el.classList].slice(1).join(" ")]); // e.g. <p class="star-rating Three">
      }

      walk(el, p);
    };
    if (item.tagName === "A" && item.getAttribute("href")) vals.push(["@href", item.href]);
    const own = [...item.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own) vals.push(["", clean([...item.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "))]);
    walk(item, "");
    return vals;
  }

  function listRows(items) {
    const per = items.map(itemValues);
    const count = new Map(), order = [];
    per.forEach((vals) => {
      const seen = new Set();
      vals.forEach(([p]) => {
        if (seen.has(p)) return;
        seen.add(p);
        if (!count.has(p)) { count.set(p, 0); order.push(p); }
        count.set(p, count.get(p) + 1);
      });
    });
    const need = Math.max(2, Math.ceil(0.25 * items.length));
    let paths = order.filter((p) => count.get(p) >= need);
    const rows = per.map((vals) => paths.map((p) => {
      const hit = vals.filter(([q]) => q === p).map(([, v]) => v);
      return [...new Set(hit)].join(" | ");
    }));
    // drop columns that never vary (button labels, "Add to basket") unless the list is tiny; class columns must vary
    const sameAs = (i, j) => rows.every((r) => r[i] === r[j]);
    const keep = paths.map((p, i) => {
      const distinct = new Set(rows.map((r) => r[i]).filter(Boolean));
      if (p.endsWith("@class")) return distinct.size > 1;
      if (paths.slice(0, i).some((_, j) => sameAs(i, j))) return false; // the image link and the title link are one URL
      return true;
    });
    // text first (title, price...), then classes, links and images: what people read before what machines use
    const rank = (q) => (q.endsWith("@src") ? 3 : q.endsWith("@href") ? 2 : q.endsWith("@class") ? 1 : 0);
    const ord = paths.map((_, i) => i).filter((i) => keep[i]).sort((a, b) => rank(paths[a]) - rank(paths[b]) || a - b);
    paths = ord.map((i) => paths[i]);
    const kept = rows.map((r) => ord.map((i) => r[i]));
    // labels that never change ("by", "Tags:", "Add to basket") start switched off; the user can turn them on
    const hidden = paths.map((p, i) => items.length >= 4 && !p.endsWith("@href") && !p.endsWith("@src") &&
      new Set(kept.map((r) => r[i])).size <= 1);
    return { columns: uniqueNames(paths.map(humanize)), paths, rows: kept, hidden };
  }

  // Items of one list share a signature path (own tag+classes, parent's, grandparent's), even when they are
  // spread over several parents (a grid built as rows of 3 cards).
  const itemKey = (el) => [el, el.parentElement, el.parentElement && el.parentElement.parentElement]
    .map((e) => (e ? sig(e) : "")).join("<");

  function lca(els) {
    let a = els[0].parentElement;
    while (a && !els.every((e) => a.contains(e))) a = a.parentElement;
    return a;
  }

  function listItems(container, key) {
    return [...container.querySelectorAll("*")].filter((e) => itemKey(e) === key);
  }

  const avgText = (rows) => rows.length ? rows.reduce((s, r) => s + r.join(" ").length, 0) / rows.length : 0;

  /* ---------- detection ---------- */
  function detect(doc, opts = {}) {
    const max = opts.max || 8;
    const found = [];
    doc.querySelectorAll("table").forEach((t) => {
      if (t.rows.length < 2) return;
      const data = tableRows(t);
      if (data.columns.length < 2 || data.rows.length < 1) return;
      if (data.rows.every((r) => r.every((c) => !c))) return;
      found.push({ kind: "table", el: t, selector: selectorFor(t), ...data,
        score: data.rows.length * data.columns.length * Math.log2(2 + avgText(data.rows)) });
    });
    const body = doc.body || doc.documentElement;
    const groups = new Map(), boxId = new Map();
    body.querySelectorAll("*").forEach((e) => {
      const t = e.tagName.toUpperCase();
      if (SKIP.has(t) || ["TD", "TH", "THEAD", "TBODY", "OPTION", "BR", "HR"].includes(t) || e.closest("svg, select")) return;
      // rows of two different tables (or lists) never form one list, even when they look the same
      const box = e.parentElement && e.parentElement.closest("table, ul, ol, dl");
      if (!boxId.has(box)) boxId.set(box, boxId.size);
      const k = itemKey(e) + "#" + boxId.get(box);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    });
    const pre = [];
    for (const [k, els] of groups) {
      if (els.length < 3) continue;
      if (els.some((e, i) => i && els[i - 1].contains(e))) continue; // nested in each other: not a flat list
      const text = els.reduce((s, e) => s + Math.min(clean(e.textContent).length, 400), 0) / els.length;
      if (text < 2 && !els[0].querySelector("img, a[href]")) continue;
      pre.push([k, els, els.length * Math.log2(2 + text) * Math.min(els[0].getElementsByTagName("*").length + 1, 30)]);
    }
    pre.sort((a, b) => b[2] - a[2]);
    for (const [k, items] of pre.slice(0, 80)) {
      const data = listRows(items);
      if (!data.columns.length || !data.paths.some((p) => !p.includes("@"))) continue;
      const c = lca(items) || body;
      found.push({ kind: "list", el: c, selector: selectorFor(c), itemKey: k.split("#")[0], items, ...data,
        score: items.length * Math.min(data.columns.length, 8) * Math.log2(2 + avgText(data.rows)) });
    }
    // a list inside the items of another list (tags on each repo card, links in each row) ranks below that list
    const owner = new Map();
    found.forEach((f, n) => (f.items || []).forEach((i) => { if (!owner.has(i)) owner.set(i, []); owner.get(i).push(n); }));
    found.forEach((f, n) => {
      if (!f.items) return;
      const inside = (i, g) => { for (let a = i.parentElement; a; a = a.parentElement) if ((owner.get(a) || []).includes(g)) return true; return false; };
      const cands = new Set();
      for (let a = f.items[0].parentElement; a; a = a.parentElement) (owner.get(a) || []).forEach((g) => g !== n && cands.add(g));
      for (const g of cands) {
        if (found[g].items.length >= 3 && f.items.every((i) => inside(i, g))) { f.score *= 0.05; break; }
      }
    });
    // the same data found twice (a list of <tr>s inside a found table; a wrapper around a list): keep the higher score
    found.sort((a, b) => b.score - a.score);
    const out = [];
    for (const f of found) {
      if (out.some((o) => (o.el === f.el || o.el.contains(f.el) || f.el.contains(o.el)) &&
        Math.abs(o.rows.length - f.rows.length) <= Math.max(2, 0.2 * o.rows.length))) continue;
      out.push(f);
      if (out.length >= max) break;
    }
    return out;
  }

  // Re-extract the same table/list on another page of the site (fetched document or the live page after a click).
  function extractLike(doc, cand) {
    let el = null;
    try { el = doc.querySelector(cand.selector); } catch (e) { el = null; }
    if (!el) {
      const again = detect(doc, { max: 20 }).filter((c) => c.kind === cand.kind);
      const same = again.find((c) => c.columns.join("|") === cand.columns.join("|")) || null;
      return same ? { rows: same.rows, el: same.el } : null;
    }
    if (cand.kind === "table") {
      const d = tableRows(el);
      return { rows: alignRows(d.columns, d.rows, cand.columns), el };
    }
    const items = listItems(el, cand.itemKey);
    if (!items.length) return null;
    const d = listRows(items);
    return { rows: alignRows(d.paths, d.rows, cand.paths), el };
  }

  function alignRows(keys, rows, want) {
    const idx = want.map((k) => keys.indexOf(k));
    return rows.map((r) => idx.map((i) => (i >= 0 ? r[i] : "")));
  }

  /* ---------- next page ---------- */
  function findNext(doc) {
    const ok = (el) => el && !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true" &&
      !/\bdisabled\b/i.test(el.className || "");
    const hrefOf = (a) => {
      const h = a.getAttribute("href");
      return h && !/^\s*(javascript:|#\s*$)/i.test(h) ? a.href : null;
    };
    let a = doc.querySelector("a[rel~='next'][href]");
    if (a && ok(a) && hrefOf(a)) return { href: hrefOf(a), selector: selectorFor(a), label: clean(a.textContent) || "next" };
    const link = doc.querySelector("link[rel~='next'][href]");
    const clickable = [...doc.querySelectorAll("a, button, [role='button'], input[type='button'], input[type='submit']")];
    const text = (el) => clean(el.textContent || el.value || "") || clean(el.getAttribute("aria-label") || el.getAttribute("title") || "");
    // carousels and banners have "next" arrows too: arrows and buttons count only inside a pager
    const pager = (el) => !!el.closest("nav, [role='navigation'], [class*='pagin' i], [class*='pager' i], [id*='pagin' i], " +
      "[class*='paging' i], [aria-label*='pagination' i]") && !el.closest("[class*='carousel' i], [class*='slide' i], [class*='banner' i]");
    const fits = (el) => ok(el) && (pager(el) || (el.tagName === "A" && hrefOf(el) && /[a-z]/i.test(text(el))));
    let hit = clickable.find((el) => fits(el) && NEXT_RE.test(text(el)));
    if (!hit) hit = clickable.find((el) => fits(el) && /^(next|next page|go to next page)$/i.test(clean(el.getAttribute("aria-label") || el.getAttribute("title") || "")));
    if (!hit) hit = clickable.find((el) => ok(el) && pager(el) && /(^|[\s_-])next([\s_-]|$)/i.test((el.className || "") + " " + (el.id || "") + " " +
      ((el.parentElement && el.parentElement.className) || "")) && text(el).length < 20);
    if (hit) {
      const h = hit.tagName === "A" ? hrefOf(hit) : null;
      return { href: h, selector: selectorFor(hit), label: text(hit) || "next" };
    }
    if (link) return { href: link.href, selector: null, label: "next" };
    return null;
  }

  /* ---------- export ---------- */
  function csvCell(v) {
    let s = v == null ? "" : String(v);
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?[\d.,]+%?$/.test(s))) s = "'" + s; // no formulas when opened in Excel
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(columns, rows) {
    return "﻿" + [columns, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  function toTSV(columns, rows) {
    return [columns, ...rows].map((r) => r.map((v) => String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
  }

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  // A ZIP with stored (uncompressed) entries: enough for .xlsx, and small enough to read and review.
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const [name, text] of files) {
      const nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const head = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0)];
      parts.push(new Uint8Array(head), nameB, data);
      central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(offset)]), nameB);
      offset += head.length + nameB.length + data.length;
    }
    const csize = central.reduce((s, p) => s + p.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(csize), ...u32(offset), ...u16(0)]);
    const all = [...parts, ...central, end];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  const xmlText = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function colName(i) {
    let s = "";
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }
  function toXLSX(columns, rows, sheet = "Data") {
    const num = /^-?(0|[1-9]\d{0,14})(\.\d+)?$/;
    const cell = (v, r, c, bold) => {
      const ref = colName(c) + (r + 1), s = v == null ? "" : String(v);
      if (!bold && num.test(s)) return `<c r="${ref}"><v>${s}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlText(s.slice(0, 32767))}</t></is></c>`;
    };
    const sheetRows = [columns, ...rows].map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i, c, i === 0)).join("")}</row>`).join("");
    const name = xmlText(sheet.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Data");
    return zip([
      ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ["xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetRows}</sheetData></worksheet>`],
    ]);
  }

  root.TableGrabber = { detect, extractLike, findNext, tableRows, listRows, selectorFor, toCSV, toTSV, toXLSX, crc32, clean };
})(typeof globalThis !== "undefined" ? globalThis : this);
