// Christmas Dinner: renders one year's plan from years/<year>.json and keeps ticks per year.
(function () {
  var TABS = ["shopping", "timeline", "menu", "open"];
  var LSH = "cd-hide-v1";
  var plan = null;      // the loaded year file
  var year = null;      // the year being viewed (may differ from plan.year when copied forward)
  var done = new Set();
  var toastTimer = null;

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
    document.getElementById("p-menu").innerHTML = lead +
      plan.menu.map(function (d) {
        var ok = d.status === "set";
        return '<article class="dish"><div class="dtop"><h2 class="dname">' + (d.url ? '<a href="' + esc(d.url) + '">' + esc(d.name) + '</a>' : esc(d.name)) +
          '</h2><span class="status' + (ok ? '' : ' need') + '">' + esc(ok ? "Recipe set" : d.status) + '</span></div>' +
          d.lines.map(function (x) { return '<p class="dline"><b>' + esc(x.label) + ':</b> ' + esc(x.text) + '</p>'; }).join("") + '</article>';
      }).join("");
    document.getElementById("p-open").innerHTML = lead + barHTML("open", "items") +
      '<p class="note-top">Decisions still to make. Tick them off once settled.</p>' +
      '<div class="group">' + plan.open.map(row).join("") + '</div>';

    var links = plan.menu.filter(function (d) { return d.url; }).map(function (d) { return '<a href="' + esc(d.url) + '">' + esc(d.name.toLowerCase()) + '</a>'; });
    document.getElementById("footer").innerHTML = (links.length ? 'Recipes: ' + links.join(", ") + '. ' : '') +
      'Ticks are saved on this device, separately for each year.';
    setHide(lsGet(LSH) === "1");
  }

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
    var s = allItems(plan.shopping), p = allItems(plan.timeline);
    document.getElementById("sum-shop").textContent = counts(s) + " of " + s.length + " items bought";
    document.getElementById("sum-plan").textContent = counts(p) + " of " + p.length + " tasks done";
    document.getElementById("sum-open").textContent = counts(plan.open) + " of " + plan.open.length + " settled";
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

  document.addEventListener("change", function (e) {
    var i = e.target;
    if (i.id === "year") { openYear(Number(i.value)); return; }
    if (!i.dataset || !i.dataset.id) return;
    if (i.checked) done.add(i.dataset.id); else done.delete(i.dataset.id);
    apply();
    saveTicks();
  });

  function setHide(on) {
    document.getElementById("main").classList.toggle("hide-done", on);
    document.querySelectorAll("[data-hide]").forEach(function (b) { b.setAttribute("aria-pressed", on ? "true" : "false"); });
    lsSet(LSH, on ? "1" : "0");
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-hide]");
    if (b) setHide(b.getAttribute("aria-pressed") !== "true");
    var t = e.target.closest && e.target.closest(".tab");
    if (t) showTab(t.dataset.tab);
  });

  function showTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) { t.setAttribute("aria-selected", t.dataset.tab === name ? "true" : "false"); });
    document.querySelectorAll(".panel").forEach(function (p) { p.hidden = p.id !== "p-" + name; });
    history.replaceState(null, "", "#" + name);
  }

  var years = [];
  function openYear(y) {
    // Use that year's file, or the newest earlier one as a starting point.
    var have = years.filter(function (x) { return x <= y; });
    var src = have.length ? have[have.length - 1] : years[0];
    return getJSON("years/" + src + ".json").then(function (p) {
      plan = p; year = y;
      lsSet("cd-year", String(y));
      loadTicks(); render(); apply();
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
