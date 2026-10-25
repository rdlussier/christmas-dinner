# Christmas Dinner

A personal Christmas dinner planner (shopping list, timeline, menu, open items), reused every year.

- `site/` is the app: plain HTML, CSS and JavaScript with no build step. It installs to a phone home screen and works offline.
- `site/years/<year>.json` holds each year's plan. `site/years/index.json` lists the years that have a file.
- When the current year has no file yet, the app shows the newest earlier plan as a starting point, with fresh ticks.
- Ticks are saved in the browser, separately for each year. With sync on (a fine-grained GitHub token pasted into the app, Contents read and write on this repo only), they are also saved to `data/ticks-<year>.json` and shared between devices.

`.github/workflows/deploy.yml` publishes `site/` to GitHub Pages when `site/` or the workflow changes on `main`. Tick saves in `data/` do not redeploy.

## Starting a new year

Copy the latest file to `site/years/<new year>.json`, change `"year"`, edit the plan, and add the year to `site/years/index.json`.
