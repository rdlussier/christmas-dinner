// When changing app.js or app.css, bump the ?v= number in index.html and CACHE in sw.js.
// Christmas Dinner: renders one year's plan from years/<year>.json and keeps ticks per year.
(function () {
  var TABS = ["shopping", "timeline", "menu"];
  var LSH = "cd-hide-v1";
  var plan = null;      // the loaded year file
  var year = null;      // the year being viewed (may differ from plan.year when copied forward)
  var done = new Set();
  var toastTimer = null;
  var wake = null;
  // Recipes being cooked: the chips in the cooking bar, which one is showing, and where each was scrolled to.
  var cook = { tray: [], active: null, pos: {} };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ticksKey() { return "cd-ticks-" + year; }

  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  }

  // Amount engine, ported from Simmer: cups/spoons (or a count, or lb/oz) first, grams second,
  // and "the rest" worked out by walking the steps in order.
  var TSP_ML = 5, TBSP_ML = 15, CUP_ML = 250, LB_G = 453.592, OZ_G = 28.3495;
  var FRACTIONS = [[0, ""], [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"], [1, ""]];
  function pick() { var vals = [].slice.call(arguments); return FRACTIONS.filter(function (f) { return vals.some(function (w) { return Math.abs(f[0] - w) < 1e-9; }); }); }
  var SET_TSP = pick(0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1);
  var SET_COUNT = pick(0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1);
  var SET_LB = pick(0, 1 / 4, 1 / 2, 3 / 4, 1);

  function snap(x, set) {
    var whole = Math.floor(x + 1e-9), rem = x - whole, best = set[0];
    set.forEach(function (f) { if (Math.abs(rem - f[0]) < Math.abs(rem - best[0])) best = f; });
    var fv = best[0], glyph = best[1];
    if (fv === 1) { whole += 1; fv = 0; glyph = ""; }
    return { value: whole + fv, text: whole > 0 ? whole + glyph : (glyph || "0") };
  }
  function fmtVolume(ml) {
    if (!(ml > 0)) return "";
    var tsp = ml / TSP_ML;
    if (tsp < 0.09) return "a pinch";
    if (ml < 55) {
      var t = snap(tsp, SET_TSP);
      if (t.value < 3) return t.text + " tsp";
      var tbsp = Math.floor(tsp / 3 + 1e-9), r = snap(tsp - tbsp * 3, SET_TSP);
      if (r.value >= 3) { tbsp += 1; r = { value: 0, text: "0" }; }
      if (r.value === 0) return tbsp + " tbsp";
      if (Math.abs(r.value - 1.5) < 1e-9) return tbsp + "½ tbsp";
      return tbsp + " tbsp + " + r.text + " tsp";
    }
    return fmtCups(ml);
  }
  // Cups only in fractions people measure (¼ ⅓ ½ ⅔ ¾). Anything else becomes spoons:
  // 90 ml -> "6 tbsp", 281 ml -> "1 cup + 2 tbsp".
  var NICE_CUPS = pick(0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1);
  function spoons(ml) {
    var t = Math.round(ml / TBSP_ML * 2) / 2;
    if (t >= 1) return (Math.floor(t) + (t % 1 ? "½" : "")) + " tbsp";
    var s = snap(ml / TSP_ML, SET_TSP);
    return s.value > 0 ? s.text + " tsp" : "";
  }
  function fmtCups(ml) {
    var c = snap(ml / CUP_ML, NICE_CUPS);
    if (Math.abs(c.value * CUP_ML - ml) <= 3) return c.text + (c.value > 1 ? " cups" : " cup");
    if (ml <= 8 * TBSP_ML + 3) return spoons(ml);
    var x = ml / CUP_ML, whole = Math.floor(x + 1e-9), base = NICE_CUPS[0];
    NICE_CUPS.forEach(function (f) { if (f[0] < 1 && whole + f[0] <= x + 1e-9) base = f; });
    var cups = whole + base[0], text = (whole > 0 ? whole : "") + base[1];
    var rest = spoons(ml - cups * CUP_ML);
    return text + (cups > 1 ? " cups" : " cup") + (rest ? " + " + rest : "");
  }
  function trimNum(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
  function fmtGrams(g) {
    if (!(g > 0)) return "";
    var n = g < 10 ? Math.round(g * 2) / 2 : Math.round(g);
    return trimNum(n || 0.5) + " g";
  }
  function fmtWeightUnit(g, unit) {
    if (!(g > 0)) return "";
    if (unit === "lb" && g >= LB_G / 4 - 5) {
      var x = g / LB_G, s = snap(x, SET_LB);
      if (s.value > 0 && Math.abs(s.value - x) * LB_G <= Math.max(10, g * 0.02)) return s.text + " lb";
      return trimNum(Math.round(x * 10) / 10) + " lb";
    }
    var oz = g / OZ_G, n = oz < 10 ? Math.round(oz * 2) / 2 : Math.round(oz);
    return trimNum(n || 0.5) + " oz";
  }
  function fmtCount(n) {
    if (!(n > 0)) return "";
    var s = snap(n, SET_COUNT);
    if (s.value === 0) s = snap(n, FRACTIONS);
    return s.value === 0 ? "¼" : s.text;
  }
  // -> { lead: "¾ cup", weight: "90 g" }
  function amountParts(ing, f) {
    f = f == null ? 1 : f;
    var lead = ing.count > 0 ? fmtCount(ing.count * f) : ing.ml > 0 ? fmtVolume(ing.ml * f) : "";
    if (!lead && ing.grams > 0 && (ing.weightUnit === "lb" || ing.weightUnit === "oz")) lead = fmtWeightUnit(ing.grams * f, ing.weightUnit);
    return { lead: lead, weight: ing.grams > 0 ? fmtGrams(ing.grams * f) : "" };
  }
  function amountText(ing, f) {
    var p = amountParts(ing, f);
    return p.lead && p.weight ? p.lead + " (" + p.weight + ")" : (p.lead || p.weight);
  }

  var TOKEN_RE = /\{([a-z0-9][a-z0-9_-]*)(?::([^{}]*))?\}/gi;
  var VOL_UNITS = [[/^(cups?|c)$/i, CUP_ML], [/^(tablespoons?|tbsps?|tbs)$/i, TBSP_ML], [/^(teaspoons?|tsps?)$/i, TSP_ML], [/^ml$/i, 1]];
  function parseNum(s) {
    s = String(s).trim();
    var m = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (m) return Number(m[1]) / Number(m[2]);
    return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  // "rest" | "1/2" | "2 tbsp" | "50 g" | "2x" -> how much of the ingredient's total this is
  function tokenFraction(ing, spec, usedBefore) {
    var s = String(spec || "").trim().toLowerCase(), m, n;
    if (!s) return 1;
    if (s === "rest") return Math.max(0, 1 - usedBefore);
    if ((m = s.match(/^(.+?)\s*x$/)) && ing.count > 0) return parseNum(m[1]) / ing.count;
    if ((m = s.match(/^(.+?)\s*g$/)) && ing.grams > 0) return parseNum(m[1]) / ing.grams;
    if ((m = s.match(/^([\d./]+)\s*([a-z]+)$/)) && ing.ml > 0) {
      for (var i = 0; i < VOL_UNITS.length; i++) if (VOL_UNITS[i][0].test(m[2])) return parseNum(m[1]) * VOL_UNITS[i][1] / ing.ml;
    }
    n = parseNum(s);
    return n > 0 && n <= 1 ? n : 1;
  }
  // Steps as HTML, with every token replaced by its highlighted amount.
  function stepsFor(recipe) {
    var byId = {}, used = {};
    recipe.ingredients.forEach(function (i) { byId[i.id] = i; });
    return recipe.steps.map(function (step) {
      var text = typeof step === "string" ? step : step.t, out = "", last = 0, m;
      TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(text))) {
        out += esc(text.slice(last, m.index));
        last = m.index + m[0].length;
        var ing = byId[m[1]];
        if (!ing) continue;
        var before = used[m[1]] || 0, f = tokenFraction(ing, m[2], before);
        used[m[1]] = String(m[2] || "").trim() === "rest" ? 1 : before + f;
        var a = amountText(ing, f);
        if (a) out += '<b class="amt">' + esc(a) + '</b>';
        else text = text.slice(0, last) + text.slice(last).replace(/^\s+/, "");
      }
      return { when: typeof step === "string" ? "" : step.w, html: out + esc(text.slice(last)) };
    });
  }

  function stepId(key, i) { return "r-" + key + "-" + (i + 1); }

  function ingredientRow(ing) {
    var p = amountParts(ing, 1), q;
    if (p.lead || p.weight) {
      var lead = p.lead || p.weight, gr = p.lead ? p.weight : "";
      q = esc(!gr && ing.estimated ? "≈ " + lead : lead) + (gr ? '<span class="gr">' + esc(ing.estimated ? "≈ " + gr : gr) + '</span>' : '');
    } else {
      q = '<span class="soft">' + esc(ing.unmeasured || "") + '</span>';
    }
    return '<li><span class="iq">' + q + '</span><span class="in">' + esc(ing.name) + (ing.note ? ' <small>' + esc(ing.note) + '</small>' : '') + '</span></li>';
  }

  function recipeHTML(r) {
    var key = r.id, lastGroup = "", ings = "";
    r.ingredients.forEach(function (ing) {
      if (ing.group && ing.group !== lastGroup) ings += '<li class="grp">' + esc(ing.group) + '</li>';
      lastGroup = ing.group || lastGroup;
      ings += ingredientRow(ing);
    });
    var steps = stepsFor(r).map(function (s, i) {
      return '<label class="row step"><input type="checkbox" data-id="' + stepId(key, i) + '"><span class="rbody">' +
        '<span class="rtime">' + (i + 1) + '</span>' +
        '<span class="stx">' + s.html + '</span></span></label>';
    }).join("");
    var meta = ['<span>' + esc(r.servings) + '</span>'];
    if (r.time) meta.push('<span>' + esc(r.time) + '</span>');
    meta.push(r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.source) + '</a>' : '<span>' + esc(r.source) + '</span>');
    var est = r.ingredients.some(function (i) { return i.estimated; });
    return '<h3 class="rtitle">' + esc(r.title) + '</h3><p class="rmeta">' + meta.join("") + '</p>' +
      '<h4 class="rsec">Ingredients</h4><ul class="ings">' + ings + '</ul>' +
      (est ? '<p class="fine">≈ marks a weight worked out from standard conversions rather than given by the recipe.</p>' : '') +
      '<h4 class="rsec">Steps · tap to tick</h4><div class="steps">' + steps + '</div>' +
      (r.notes && r.notes.length ? '<div class="rnotes"><ul>' + r.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join("") + '</ul></div>' : '') +
      '<div class="rfoot">' + ('wakeLock' in navigator ? '<button class="btn" type="button" data-wake></button>' : '') +
      '<button class="btn" type="button" data-untick="' + esc(key) + '">Untick all steps</button></div>';
  }

  function row(it) {
    return '<label class="row"><input type="checkbox" data-id="' + esc(it.id) + '"><span class="rbody">' +
      (it.t ? '<span class="rtime">' + esc(it.t) + '</span>' : '') +
      '<span class="rmain">' + esc(it.name || it.text) + '</span>' +
      (it.qty ? '<span class="rqty">' + esc(it.qty) + '</span>' : '') +
      (it.est ? '<span class="chip">est.</span>' : '') +
      (it.note ? '<span class="rnote">' + esc(it.note) + '</span>' : '') +
      '</span></label>';
  }

  function groupHTML(g) {
    return '<div class="group"><div class="ghead"><div><h2>' + esc(g.title) + '</h2>' +
      (g.when ? '<div class="gwhen">' + esc(g.when) + '</div>' : '') +
      '</div><div class="gcnt" id="cnt-' + esc(g.id) + '"></div></div>' + g.items.map(row).join('') + '</div>';
  }

  function barHTML(id, label) {
    return '<div class="bar"><div class="sum" id="sum-' + id + '"></div><button class="btn" type="button" data-hide aria-pressed="false">Hide ticked ' + label + '</button></div>';
  }

  function render() {
    var copied = plan.year !== year;
    document.getElementById("title").textContent = plan.title + " " + year;
    document.getElementById("sub").textContent = plan.guests + " guests · sit down " + plan.sitDown + " · " + (copied ? "date to be set" : (plan.date || "date to be set"));
    var lead = copied ? '<div class="callout" style="margin:0 0 16px"><b>No ' + year + ' plan yet.</b> This is the ' + plan.year + ' plan as a starting point, with fresh ticks for ' + year + '. Ask Claude to make a ' + year + ' version with this year\'s changes.</div>' : '';

    document.getElementById("p-shopping").innerHTML = lead + barHTML("shop", "items") +
      '<p class="note-top">Scaled for ' + esc(plan.guests) + ' people. Tick an item to grey it out.</p>' +
      plan.shopping.map(groupHTML).join("");
    document.getElementById("p-timeline").innerHTML = lead + barHTML("plan", "tasks") +
      '<p class="note-top">Times assume a ' + esc(plan.sitDown) + ' sit-down. D is dinner day.</p>' +
      plan.timeline.map(groupHTML).join("") +
      (plan.callouts || []).map(function (c) { return '<div class="callout"><b>' + esc(c.title) + '</b> ' + esc(c.text) + '</div>'; }).join("");
    document.getElementById("p-menu").innerHTML = '<div id="mlist">' + lead +
      (plan.menu.some(function (d) { return d.recipe; }) ? '<p class="note-top">Tap Cook this to open a recipe. Each one you open gets a tab in the bar at the top, so you can jump between dishes and land back where you were.</p>' : '') +
      plan.menu.map(function (d) {
        return '<article class="dish"><div class="dtop"><h2 class="dname">' + (d.url ? '<a href="' + esc(d.url) + '">' + esc(d.name) + '</a>' : esc(d.name)) +
          '</h2></div>' +
          d.lines.map(function (x) { return '<p class="dline"><b>' + esc(x.label) + ':</b> ' + esc(x.text) + '</p>'; }).join("") +
          (d.recipe ? '<div class="dact"><button class="btn open" type="button" data-cook="' + esc(d.recipe.id) + '">Cook this</button><span class="dprog" id="prog-' + esc(d.recipe.id) + '"></span></div>' : '') +
          '</article>';
      }).join("") + '</div><div id="mrec" hidden></div>';

    var links = plan.menu.filter(function (d) { return d.url; }).map(function (d) { return '<a href="' + esc(d.url) + '">' + esc(d.name.toLowerCase()) + '</a>'; });
    document.getElementById("footer").innerHTML = (links.length ? 'Recipes: ' + links.join(", ") + '. ' : '') +
      'Ticks are saved separately for each year, on this device and, with sync on, in the repo.';
    setHide(lsGet(LSH) === "1");
    renderCook();
  }

  function recipeById(k) {
    var m = plan.menu.filter(function (d) { return d.recipe && d.recipe.id === k; })[0];
    return m ? m.recipe : null;
  }
  function cookKey() { return "cd-cooking-" + year; }
  function loadCook() {
    cook = { tray: [], active: null, pos: {} };
    try {
      var c = JSON.parse(lsGet(cookKey()) || "null");
      if (c && Array.isArray(c.tray)) cook = { tray: c.tray.filter(recipeById), active: recipeById(c.active) ? c.active : null, pos: c.pos || {} };
    } catch (e) {}
  }
  function saveCook() { lsSet(cookKey(), JSON.stringify(cook)); }
  function renderCook() {
    var bar = document.getElementById("cookbar");
    bar.hidden = !cook.tray.length;
    bar.innerHTML = '<button class="cchip" type="button" data-cook="" aria-pressed="' + (!cook.active) + '">All dishes</button>' +
      cook.tray.map(function (k) {
        var r = recipeById(k);
        return '<button class="cchip" type="button" data-cook="' + esc(k) + '" aria-pressed="' + (cook.active === k) + '">' + esc(r.short || r.title) + '<span class="cprog" id="cp-' + esc(k) + '"></span></button>';
      }).join("");
    var k = cook.active, rec = document.getElementById("mrec");
    document.getElementById("mlist").hidden = !!k;
    rec.hidden = !k;
    rec.innerHTML = k ? '<div class="rhead"><button class="btn" type="button" data-cook="">← All dishes</button><button class="btn" type="button" data-uncook="' + esc(k) + '">Done with this dish</button></div>' +
      '<div class="recipe">' + recipeHTML(recipeById(k)) + '</div>' : '';
    var on = bar.querySelector('[aria-pressed="true"]');
    if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    wakeUI();
  }
  function menuShowing() { return !document.getElementById("p-menu").hidden; }
  // Switch to a recipe (or "" for the dish list) and put the page back where it was.
  function openCook(k) {
    k = k || null;
    if (k && cook.tray.indexOf(k) < 0) cook.tray.push(k);
    cook.active = k;
    saveCook();
    showTab("menu");
    renderCook();
    apply();
    restoreScroll();
  }
  function restoreScroll() {
    var y = cook.pos[cook.active || "list"];
    if (y == null) y = cook.active ? document.getElementById("main").offsetTop - document.querySelector("nav").offsetHeight : 0;
    window.scrollTo(0, Math.max(0, y));
  }
  function uncook(k) {
    cook.tray = cook.tray.filter(function (x) { return x !== k; });
    delete cook.pos[k];
    openCook(null);
  }
  var scrollTimer = null;
  window.addEventListener("scroll", function () {
    if (!plan || !menuShowing()) return;
    cook.pos[cook.active || "list"] = Math.round(window.scrollY);
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveCook, 300);
  }, { passive: true });

  function counts(items) { var d = 0; items.forEach(function (i) { if (done.has(i.id)) d++; }); return d; }
  function allItems(groups) { var a = []; groups.forEach(function (g) { a = a.concat(g.items); }); return a; }

  function apply() {
    document.querySelectorAll("input[data-id]").forEach(function (i) {
      var d = done.has(i.dataset.id);
      i.checked = d;
      i.closest(".row").classList.toggle("is-done", d);
    });
    [plan.shopping, plan.timeline].forEach(function (groups) {
      groups.forEach(function (g) {
        var el = document.getElementById("cnt-" + g.id);
        if (el) el.textContent = counts(g.items) + " / " + g.items.length;
      });
    });
    plan.menu.forEach(function (m) {
      var el = m.recipe && document.getElementById("prog-" + m.recipe.id);
      if (!el) return;
      var n = m.recipe.steps.length, d = 0;
      for (var i = 0; i < n; i++) if (done.has(stepId(m.recipe.id, i))) d++;
      el.textContent = d ? d + " of " + n + " steps done" : n + " steps";
      var cp = document.getElementById("cp-" + m.recipe.id);
      if (cp) cp.textContent = d + "/" + n;
    });
    // Mark the first unticked step so the eye lands on it after a switch.
    var next = false;
    document.querySelectorAll("#mrec .row.step").forEach(function (r) {
      var isNext = !next && !r.classList.contains("is-done");
      if (isNext) next = true;
      r.classList.toggle("next", isNext);
    });
    var s = allItems(plan.shopping), p = allItems(plan.timeline);
    document.getElementById("sum-shop").textContent = counts(s) + " of " + s.length + " items bought";
    document.getElementById("sum-plan").textContent = counts(p) + " of " + p.length + " tasks done";
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function loadTicks() {
    done = new Set();
    try { JSON.parse(lsGet(ticksKey()) || "[]").forEach(function (x) { done.add(x); }); } catch (e) {}
  }
  function saveTicks() { lsSet(ticksKey(), JSON.stringify(Array.from(done))); }

  // Sync: ticks for each year live in data/ticks-<year>.json in the repo, read and
  // written through the GitHub contents API with a token kept in this browser.
  // Taps are queued as per-item changes and replayed onto the latest remote copy,
  // so ticks from two devices merge instead of overwriting each other.
  var REPO = "rdlussier/christmas-dinner";
  var TOKEN_KEY = "cd-gh-token";
  var syncing = false, again = false, pushTimer = null, lastSync = null;

  function token() { return lsGet(TOKEN_KEY) || ""; }
  function pendingKey() { return "cd-pending-" + year; }
  function getPending() { try { return JSON.parse(lsGet(pendingKey()) || "{}"); } catch (e) { return {}; } }
  function setPending(p) { lsSet(pendingKey(), JSON.stringify(p)); }

  function setSync(text) { document.getElementById("sync").textContent = text; }
  function syncIdle() {
    if (!token()) { setSync("This device only · set up sync"); return; }
    var n = Object.keys(getPending()).length;
    setSync(n ? n + " tick" + (n > 1 ? "s" : "") + " waiting to sync" :
      "Synced" + (lastSync ? " · " + lastSync.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""));
  }

  function gh(method, path, body) {
    return fetch("https://api.github.com/repos/" + REPO + "/contents/" + path, {
      method: method,
      cache: "no-store",
      headers: { "Authorization": "Bearer " + token(), "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  function b64decode(s) { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), function (c) { return c.charCodeAt(0); })); }
  function b64encode(s) { var b = new TextEncoder().encode(s), out = ""; b.forEach(function (x) { out += String.fromCharCode(x); }); return btoa(out); }

  function readRemote(y) {
    return gh("GET", "data/ticks-" + y + ".json").then(function (r) {
      if (r.status === 404) return { sha: null, done: [] };
      if (r.status === 401 || r.status === 403) throw new Error("auth");
      if (!r.ok) throw new Error("http " + r.status);
      return r.json().then(function (f) { return { sha: f.sha, done: JSON.parse(b64decode(f.content)).done || [] }; });
    });
  }

  // Pull the latest ticks, replay queued taps on top, and write back if anything was queued.
  function sync(tries) {
    if (!token() || !plan) return Promise.resolve();
    if (syncing) { again = true; return Promise.resolve(); }
    syncing = true;
    var y = year, ops = getPending(), ids = Object.keys(ops);
    if (ids.length) setSync("Syncing…");
    return readRemote(y).then(function (remote) {
      var set = new Set(remote.done);
      ids.forEach(function (id) { if (ops[id]) set.add(id); else set.delete(id); });
      if (!ids.length) return set;
      var body = { message: "Update " + y + " ticks", content: b64encode(JSON.stringify({ done: Array.from(set).sort(), updated: new Date().toISOString() }, null, 2) + "\n") };
      if (remote.sha) body.sha = remote.sha;
      return gh("PUT", "data/ticks-" + y + ".json", body).then(function (r) {
        if (r.status === 409 || r.status === 422) throw new Error("conflict");
        if (r.status === 401 || r.status === 403) throw new Error("auth");
        if (!r.ok) throw new Error("http " + r.status);
        // Drop only the taps we sent; newer taps stay queued.
        var now = getPending();
        ids.forEach(function (id) { if (now[id] === ops[id]) delete now[id]; });
        setPending(now);
        return set;
      });
    }).then(function (set) {
      if (y !== year) return;
      var latest = getPending();
      Object.keys(latest).forEach(function (id) { if (latest[id]) set.add(id); else set.delete(id); });
      done = set; saveTicks(); apply();
      lastSync = new Date(); syncIdle();
    }).catch(function (err) {
      if (err.message === "conflict" && (tries || 0) < 3) { syncing = false; return sync((tries || 0) + 1); }
      if (err.message === "auth") setSync("Sync token rejected · tap to fix");
      else setSync("Offline · ticks saved on this device");
    }).then(function () {
      syncing = false;
      if (again) { again = false; schedulePush(); }
    });
  }

  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(sync, 700); }
  function queueOp(id, val) {
    var p = getPending(); p[id] = val; setPending(p);
    if (token()) { syncIdle(); schedulePush(); }
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) sync(); });
  window.addEventListener("online", function () { sync(); });
  setInterval(function () { if (!document.hidden) sync(); }, 30000);

  var dlg = document.getElementById("syncdlg");
  document.getElementById("sync").addEventListener("click", function () {
    document.getElementById("tok").value = token();
    document.getElementById("dlgmsg").textContent = "";
    dlg.showModal();
  });
  document.getElementById("toksave").addEventListener("click", function () {
    var t = document.getElementById("tok").value.trim(), msg = document.getElementById("dlgmsg");
    if (!t) { msg.textContent = "Paste a token first."; return; }
    msg.textContent = "Checking…";
    lsSet(TOKEN_KEY, t);
    // Queue everything ticked on this device so it merges into the shared copy.
    var p = getPending(); done.forEach(function (id) { if (!(id in p)) p[id] = true; }); setPending(p);
    readRemote(year).then(function () {
      dlg.close(); sync(); toast("Sync is on for this device.");
    }).catch(function (err) {
      msg.textContent = err.message === "auth" ? "GitHub rejected that token. Check it has Contents read and write on christmas-dinner." : "Could not reach GitHub. Check your connection.";
    });
  });
  document.getElementById("tokoff").addEventListener("click", function () {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    dlg.close(); syncIdle(); toast("Sync is off. Ticks save on this device only.");
  });

  document.addEventListener("change", function (e) {
    var i = e.target;
    if (i.id === "year") { openYear(Number(i.value)); return; }
    if (!i.dataset || !i.dataset.id) return;
    if (i.checked) done.add(i.dataset.id); else done.delete(i.dataset.id);
    apply();
    saveTicks();
    queueOp(i.dataset.id, i.checked);
  });

  function setHide(on) {
    document.getElementById("main").classList.toggle("hide-done", on);
    document.querySelectorAll("[data-hide]").forEach(function (b) { b.setAttribute("aria-pressed", on ? "true" : "false"); });
    lsSet(LSH, on ? "1" : "0");
  }
  function wakeUI() {
    document.querySelectorAll("[data-wake]").forEach(function (b) {
      b.textContent = wake ? "Screen stays on" : "Keep screen on";
      b.setAttribute("aria-pressed", wake ? "true" : "false");
    });
  }
  async function toggleWake() {
    try {
      if (wake) { await wake.release(); wake = null; }
      else {
        wake = await navigator.wakeLock.request("screen");
        wake.addEventListener("release", function () { wake = null; wakeUI(); });
      }
    } catch (e) { wake = null; toast("This browser would not keep the screen on."); }
    wakeUI();
  }

  function untick(key) {
    var m = plan.menu.filter(function (d) { return d.recipe && d.recipe.id === key; })[0];
    if (!m) return;
    m.recipe.steps.forEach(function (s, i) {
      var id = stepId(key, i);
      if (done.has(id)) { done.delete(id); queueOp(id, false); }
    });
    saveTicks(); apply();
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var b = e.target.closest("[data-hide]");
    if (b) setHide(b.getAttribute("aria-pressed") !== "true");
    var t = e.target.closest(".tab");
    if (t) showTab(t.dataset.tab);
    var c = e.target.closest("[data-cook]");
    if (c) openCook(c.getAttribute("data-cook"));
    var x = e.target.closest("[data-uncook]");
    if (x) uncook(x.getAttribute("data-uncook"));
    if (e.target.closest("[data-wake]")) toggleWake();
    var u = e.target.closest("[data-untick]");
    if (u) untick(u.getAttribute("data-untick"));
  });

  function showTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) { t.setAttribute("aria-selected", t.dataset.tab === name ? "true" : "false"); });
    var was = plan && menuShowing();
    document.querySelectorAll(".panel").forEach(function (p) { p.hidden = p.id !== "p-" + name; });
    history.replaceState(null, "", "#" + name);
    if (plan && name === "menu" && !was) restoreScroll();
  }

  var years = [];
  function openYear(y) {
    // Use that year's file, or the newest earlier one as a starting point.
    var have = years.filter(function (x) { return x <= y; });
    var src = have.length ? have[have.length - 1] : years[0];
    return getJSON("years/" + src + ".json").then(function (p) {
      plan = p; year = y;
      lsSet("cd-year", String(y));
      loadTicks(); loadCook(); render(); apply(); syncIdle(); sync();
    }).catch(function () { toast("Could not load the " + y + " plan."); });
  }

  getJSON("years/index.json").then(function (idx) {
    years = idx.years.slice().sort();
    var now = new Date().getFullYear();
    var opts = years.slice();
    if (opts.indexOf(now) < 0 && now > years[years.length - 1]) opts.push(now);
    var sel = document.getElementById("year");
    sel.innerHTML = opts.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join("");
    var want = Number(new URLSearchParams(location.search).get("year")) || Number(lsGet("cd-year")) || opts[opts.length - 1];
    if (opts.indexOf(want) < 0) want = opts[opts.length - 1];
    sel.value = String(want);
    var h = (location.hash || "").replace("#", "");
    if (TABS.indexOf(h) >= 0) showTab(h);
    return openYear(want);
  }).catch(function () { toast("Could not load the plan. Check your connection."); });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
