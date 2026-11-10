// Draws the profile contribution graphic in light and dark: each day of the last year is a small
// blue orb sized by its contribution level, Carbon walks in and kicks the year away, and the orbs
// light up again while he leaves. Reads the real calendar from the GitHub GraphQL API.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOGIN = process.env.LOGIN || "BatuCani";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT_DIR || join(ROOT, "dist");
const SHEET = join(ROOT, "assets", "carbon-sheet.webp");

const W = 880;
const H = 320;
const PAD = 45;
const RADIUS = 18;
const DUR = 18;
const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Orb radius per contribution level, in grid pitches.
const ORB = [0, 0.22, 0.29, 0.36, 0.44];
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

// The sheet is four rows of ten 192x256 frames: enter (walk, then wave), kick, pause, cheer.
// Shown at 130x173. On the kick row, frame 5 reaches the toe to source pixel (184, 96).
const SRC = { w: 1920, h: 1024, frame: 192, row: 256 };
const SHOW_W = 130;
const SHOW_H = 173;
const ROW = { enter: 0, kick: 1, pause: 2, cheer: 3 };
const FOOT_X = (184 * SHOW_W) / SRC.frame;
const FOOT_Y = (96 * SHOW_H) / SRC.row;
const SOLE = (240 * SHOW_H) / SRC.row;

const THEMES = {
  dark: {
    ground: "#0A0A0C", edge: "#191E28", kicker: "#45EEEC", quiet: "#3A6FC0", title: "#F1F5FA",
    sub: "#8FB5EC", foot: "#557FBE", dot: "#2F6CC4", dotAlpha: 0.32, halo: "#2F6CC4", haloAlpha: 0.42,
    ring: null, shade: "#245CC0", shadeAlpha: 0.28,
  },
  light: {
    ground: "#F8FAFD", edge: "#DAE2EE", kicker: "#245CC0", quiet: "#98B4E2", title: "#0A0A0C",
    sub: "#2F6CC4", foot: "#5D7FB6", dot: "#245CC0", dotAlpha: 0.2, halo: "#45EEEC", haloAlpha: 0.32,
    ring: "#0A0A0C", shade: "#0A0A0C", shadeAlpha: 0.12,
  },
};

function readToken() {
  const fromEnv = process.env.GITHUB_TOKEN;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    fail("Set GITHUB_TOKEN, or sign in so `gh auth token` can run.");
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function fetchCalendar(token) {
  const query = `query($login: String!) { user(login: $login) { login contributionsCollection {
    contributionCalendar { totalContributions weeks { contributionDays {
      date weekday contributionCount contributionLevel } } } } } }`;
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-contrib-render" },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  if (!response.ok) fail(`GitHub GraphQL answered HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.errors?.length) fail(payload.errors.map((error) => error.message).join("\n"));
  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar?.weeks?.length) fail(`No contribution calendar for ${LOGIN}.`);
  const weeks = calendar.weeks.map((week) => week.contributionDays.map((day) => {
    if (!(day.contributionLevel in LEVEL)) fail(`Unknown contribution level ${day.contributionLevel}.`);
    return { date: day.date, row: day.weekday, count: day.contributionCount, level: LEVEL[day.contributionLevel] };
  }));
  const sum = weeks.flat().reduce((total, day) => total + day.count, 0);
  return { weeks, total: calendar.totalContributions, sum };
}

// GitHub's total and the sum of its days can briefly disagree by a contribution while new activity
// settles. Ask again a few times; if they still differ, keep GitHub's total, the number the profile
// itself shows, and leave a warning in the run log instead of failing the refresh.
async function settledCalendar(token) {
  let calendar;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    calendar = await fetchCalendar(token);
    if (calendar.sum === calendar.total) return calendar;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  console.warn(`::warning::Calendar days add up to ${calendar.sum}, but GitHub reports ${calendar.total}; using ${calendar.total}.`);
  return calendar;
}

function loadSheet() {
  const buffer = readFileSync(SHEET);
  const isWebp = buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 16) === "WEBPVP8X";
  const width = isWebp ? buffer.readUIntLE(24, 3) + 1 : 0;
  const height = isWebp ? buffer.readUIntLE(27, 3) + 1 : 0;
  if (width !== SRC.w || height !== SRC.h) {
    fail(`${SHEET} must be an extended WebP of ${SRC.w}x${SRC.h}; run scripts/encode-carbon.sh.`);
  }
  return `data:image/webp;base64,${buffer.toString("base64")}`;
}

const n = (value) => String(Number(value.toFixed(2)));
const pct = (seconds) => n((Math.max(0, Math.min(DUR, seconds)) / DUR) * 100);
const xml = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (value) => new Intl.NumberFormat("en-US").format(value);

function day(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const options = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", options).format(new Date(Date.UTC(y, m - 1, d)));
}

// Keyframes from [seconds, declarations] pairs; equal neighbours collapse into one selector list.
function keyframes(name, stops) {
  const merged = [];
  for (const [time, body] of stops) {
    const at = `${pct(time)}%`;
    const last = merged[merged.length - 1];
    if (last && last.at[last.at.length - 1] === at) last.body = body;
    else if (last && last.body === body) last.at.push(at);
    else merged.push({ at: [at], body });
  }
  return `@keyframes ${name}{${merged.map((stop) => `${stop.at.join(",")}{${stop.body}}`).join("")}}`;
}

// The kicks: seven groups of weeks, six light kicks a second apart, a pause, then one heavy kick.
function kickGroups(columns) {
  const cuts = [0.13, 0.26, 0.39, 0.52, 0.65, 0.8, 1];
  const impacts = [4.55, 5.55, 6.55, 7.55, 8.55, 9.55, 11.55];
  const power = [1, 1.12, 1.24, 1.36, 1.5, 1.65, 2.35];
  let start = 0;
  return cuts.map((cut, index) => {
    const end = index === cuts.length - 1 ? columns : Math.max(start + 1, Math.round(columns * cut));
    const group = { start, end, impact: impacts[index], power: power[index], final: index === cuts.length - 1 };
    start = end;
    return group;
  });
}

function timeline(columns, colX) {
  const groups = kickGroups(columns);
  const stand = (column) => colX(column) - FOOT_X;
  const home = stand(groups[0].end - 1);
  const last = stand(columns - 1);
  const off = -SHOW_W - 36;
  const gone = W + 24;
  const cheerAt = 12.5;
  const leaveAt = 14.6;
  const leaveFor = 2.3;

  // Where Carbon stands, as [seconds, x, easing into the next mark].
  const walk = "linear";
  const glide = "cubic-bezier(.45,0,.55,1)";
  const marks = [[0, off, walk], [2.4, home, glide]];
  groups.forEach((group, index) => {
    const x = stand(group.end - 1);
    if (index === 0) marks.push([group.impact + 0.34, x, glide]);
    else if (group.final) {
      marks.push([10.15, stand(groups[index - 1].end - 1), glide]);
      marks.push([group.impact - 0.22, x, glide]);
    } else {
      marks.push([Math.max(group.impact - 0.28, groups[index - 1].impact + 0.36), x, glide]);
      marks.push([group.impact + 0.34, x, glide]);
    }
  });
  marks.push([leaveAt, last, walk], [leaveAt + leaveFor, gone, walk], [DUR, gone, walk]);

  // Which frame shows when, as [seconds, row, frame]; the track steps, it never blends.
  const frames = [];
  for (let step = 0; step < 20; step += 1) frames.push([step * 0.12, ROW.enter, step % 4]);
  for (let step = 0; step < 12; step += 1) frames.push([2.4 + step * (0.8 / 6), ROW.enter, 4 + (step % 6)]);
  for (const start of [4, 5, 6, 7, 8, 9]) {
    for (let frame = 0; frame < 10; frame += 1) frames.push([start + frame * 0.1, ROW.kick, frame]);
  }
  for (let frame = 0; frame < 10; frame += 1) frames.push([10 + frame * 0.1, ROW.pause, frame]);
  for (let frame = 0; frame < 10; frame += 1) frames.push([11 + frame * 0.1, ROW.kick, frame]);
  for (let frame = 0; frame < 10; frame += 1) frames.push([cheerAt + frame * 0.16, ROW.cheer, frame]);
  const steps = Math.round(leaveFor / 0.12);
  for (let step = 0; step <= steps; step += 1) frames.push([leaveAt + step * 0.12, ROW.enter, step % 4]);

  return { groups, marks, frames, home, cheerAt };
}

function render(calendar, sheet, theme) {
  const t = THEMES[theme];
  const { weeks, total } = calendar;
  const columns = weeks.length;
  const pitch = (W - 2 * PAD) / columns;
  const gridTop = 98;
  const kickY = gridTop + 3.5 * pitch;
  const colX = (column) => PAD + (column + 0.5) * pitch;
  const actorTop = kickY - FOOT_Y;
  const { groups, marks, frames, home, cheerAt } = timeline(columns, colX);
  const first = weeks[0][0].date;
  const lastWeek = weeks[columns - 1];
  const last = lastWeek[lastWeek.length - 1].date;
  const captionY = 288;

  // Faint dots for every day, one path; the orbs sit on top of them.
  const dots = weeks.map((week, column) => week.map((d) => `M${column} ${d.row}h0`).join("")).join("");

  // Orbs, grouped by week so each week flies on its own track when it is kicked.
  const owner = [];
  groups.forEach((group) => {
    for (let column = group.start; column < group.end; column += 1) owner[column] = { group, place: column - group.start };
  });
  let css = "";
  let orbs = "";
  weeks.forEach((week, column) => {
    const lit = week.filter((d) => d.level > 0);
    if (!lit.length) return;
    const { group, place } = owner[column];
    const hit = group.impact + place * 0.03;
    const f = group.final;
    const dir = column % 2 === 0 ? 1 : -1;
    const dx = ((16 + (column % 5) * 6) * group.power) / pitch;
    const lift = ((14 + (column % 3) * 5) * Math.min(group.power, 1.55)) / pitch;
    const drop = (f ? 40 : 26) / pitch;
    const rot = (10 + (column % 4) * 4) * dir;
    const back = 13 + (1.7 * column) / Math.max(1, columns - 1);
    const rest = "transform:none;opacity:1";
    css += keyframes(`k${column}`, [
      [0, rest],
      [hit, `${rest};animation-timing-function:cubic-bezier(.2,.8,.3,1)`],
      [hit + (f ? 0.21 : 0.16), `transform:translate(${n(dx * 0.35)}px,${n(-lift)}px) rotate(${n(rot * 0.3)}deg) scale(1.18);opacity:1;animation-timing-function:ease-in`],
      [hit + (f ? 0.54 : 0.42), `transform:translate(${n(dx * 0.72)}px,${n(-lift * 0.35)}px) rotate(${n(rot * 0.7)}deg) scale(.9);opacity:.7`],
      [hit + (f ? 1.15 : 0.83), `transform:translate(${n(dx)}px,${n(drop)}px) rotate(${rot}deg) scale(.28);opacity:0`],
      [back, "transform:scale(.2);opacity:0;animation-timing-function:cubic-bezier(.3,1.4,.5,1)"],
      [back + 0.55, rest],
      [DUR, rest],
    ]);
    css += `.k${column} use{animation-name:k${column}}`;
    // The position sits on a wrapper: on a <use> with x/y, fill-box scaling pivots on the grid origin.
    orbs += `<g class="k${column}">${lit.map((d) => `<g transform="translate(${column} ${d.row})"><use href="#o${d.level}"/></g>`).join("")}</g>`;
  });

  // A soft ring of light where each kick lands.
  let bursts = "";
  groups.forEach((group, index) => {
    const size = group.final ? 1.7 : 1;
    css += keyframes(`b${index}`, [
      [0, "opacity:0;transform:scale(.3)"],
      [group.impact - 0.04, "opacity:0;transform:scale(.3)"],
      [group.impact + 0.04, `opacity:.95;transform:scale(${n(size)})`],
      [group.impact + (group.final ? 0.5 : 0.32), `opacity:0;transform:scale(${n(size * 2)})`],
      [DUR, `opacity:0;transform:scale(${n(size * 2)})`],
    ]);
    bursts += `<g transform="translate(${n(colX(group.end - 1))} ${n(kickY)})"><use class="b b${index}" href="#burst"/></g>`;
  });

  css += keyframes("walk", marks.map(([time, x, ease]) => [time, `transform:translate(${n(x)}px,${n(actorTop)}px);animation-timing-function:${ease}`]));
  css += keyframes("frames", frames.map(([time, row, frame]) => [time, `transform:translate(${n(-frame * SHOW_W)}px,${n(-row * SHOW_H)}px)`]));
  css += keyframes("hop", [
    [0, "transform:none"], [cheerAt + 0.24, "transform:none"], [cheerAt + 0.42, "transform:translateY(-12px)"],
    [cheerAt + 0.66, "transform:translateY(-12px)"], [cheerAt + 0.86, "transform:none"], [DUR, "transform:none"],
  ]);
  css += keyframes("shade", [
    [0, "opacity:1"], [cheerAt + 0.24, "opacity:1"], [cheerAt + 0.42, "opacity:.45"],
    [cheerAt + 0.66, "opacity:.45"], [cheerAt + 0.86, "opacity:1"], [DUR, "opacity:1"],
  ]);

  // Month names over the first week that starts in each month, skipping a cramped first one.
  const months = [];
  weeks.forEach((week, column) => {
    const month = week[0].date.slice(0, 7);
    if (column === 0 || month !== weeks[column - 1][0].date.slice(0, 7)) months.push({ column, month });
  });
  if (months.length > 1 && months[1].column - months[0].column < 3) months.shift();
  const monthLabels = months
    .filter(({ column }) => column <= columns - 3)
    .map(({ column, month }) => {
      const name = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${month}-15T00:00:00Z`));
      return `<text x="${n(colX(column) - pitch * 0.4)}" y="${gridTop - 10}">${name}</text>`;
    })
    .join("");

  // Legend: Less, the four orb sizes, More. Right-aligned to the grid.
  const moreW = 30;
  const legendStep = 17;
  const legendEnd = W - PAD - moreW - 4;
  const legendOrbs = [1, 2, 3, 4]
    .map((level, index) => `<use href="#o${level}" x="${n((legendEnd - (3 - index) * legendStep - 6) / pitch)}" y="${n((captionY - 5) / pitch)}"/>`)
    .join("");
  const legendStart = legendEnd - 3 * legendStep - 6 - pitch * ORB[1] - 8;

  const orbDefs = [1, 2, 3, 4].map((level) => {
    const r = ORB[level];
    const ring = t.ring ? ` stroke="${t.ring}" stroke-width=".03"` : "";
    return `<g id="o${level}"><circle r="${n(r * 1.9)}" fill="url(#h)"/><circle r="${r}" fill="url(#g)"${ring}/></g>`;
  }).join("");

  const range = `${day(first)} to ${day(last)}`;
  const desc = `${fmt(total)} contributions from ${range}. Carbon walks in, kicks the year's contributions away, and they light up again.`;
  const sheetW = SHOW_W * 10;
  const sheetH = SHOW_H * 4;
  const shadeX = SHOW_W * 0.47;

  const style = `text{font-family:${FONT}}
.o use,.b{transform-box:fill-box;transform-origin:center;animation:${DUR}s linear infinite}
.o g:nth-child(3n+1) use{animation-delay:-.03s}.o g:nth-child(3n+2) use{animation-delay:.03s}
.actor{animation:walk ${DUR}s infinite}.sp{animation:frames ${DUR}s step-end infinite}
.hop{animation:hop ${DUR}s ease-in-out infinite}.shade{transform-box:fill-box;transform-origin:center;animation:shade ${DUR}s ease-in-out infinite}
.b{opacity:0}${groups.map((_, index) => `.b${index}{animation-name:b${index}}`).join("")}
${css}
@media (prefers-reduced-motion:reduce){.o use,.b,.actor,.sp,.hop,.shade{animation:none}.actor{transform:translate(${n(home)}px,${n(actorTop)}px)}.sp{transform:translateY(${-ROW.kick * SHOW_H}px)}}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">${fmt(total)} contributions in the last year</title>
<desc id="d">${xml(desc)}</desc>
<style>${style}</style>
<defs>
<radialGradient id="g" fx=".5" fy=".62"><stop offset="0" stop-color="#245CC0"/><stop offset=".5" stop-color="#2F6CC4"/><stop offset=".72" stop-color="#488ADE"/><stop offset=".86" stop-color="#45EEEC"/><stop offset=".95" stop-color="#8CF6F2"/></radialGradient>
<radialGradient id="h"><stop offset=".45" stop-color="${t.halo}" stop-opacity="${t.haloAlpha}"/><stop offset="1" stop-color="${t.halo}" stop-opacity="0"/></radialGradient>
<radialGradient id="bg"><stop offset="0" stop-color="#8CF6F2" stop-opacity=".55"/><stop offset="1" stop-color="#45EEEC" stop-opacity="0"/></radialGradient>
<radialGradient id="sh"><stop offset="0" stop-color="${t.shade}" stop-opacity="${t.shadeAlpha}"/><stop offset="1" stop-color="${t.shade}" stop-opacity="0"/></radialGradient>
${orbDefs}
<g id="burst"><circle r="12" fill="url(#bg)"/><circle r="9" fill="none" stroke="#45EEEC" stroke-width="1.4"/></g>
<clipPath id="card"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${RADIUS - 1}"/></clipPath>
<clipPath id="frame"><rect width="${SHOW_W}" height="${SHOW_H}"/></clipPath>
</defs>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="${RADIUS - 0.5}" fill="${t.ground}" stroke="${t.edge}"/>
<text x="${PAD}" y="54" fill="${t.kicker}" font-size="12.5" letter-spacing=".2em">CONTRIBUTIONS · LAST 12 MONTHS</text>
<text x="${W - PAD}" y="54" fill="${t.quiet}" font-size="12.5" text-anchor="end">${xml(range)}</text>
<g fill="${t.foot}" font-size="10.5">${monthLabels}</g>
<g clip-path="url(#card)">
<g transform="translate(${n(colX(0))} ${n(gridTop + pitch / 2)}) scale(${n(pitch)})">
<path d="${dots}" stroke="${t.dot}" stroke-opacity="${t.dotAlpha}" stroke-width=".15" stroke-linecap="round"/>
<g class="o">${orbs}</g>
</g>
${bursts}
<g class="actor"><ellipse class="shade" cx="${n(shadeX)}" cy="${n(SOLE)}" rx="40" ry="6" fill="url(#sh)"/><g class="hop"><g clip-path="url(#frame)"><image class="sp" href="${sheet}" width="${sheetW}" height="${sheetH}"/></g></g></g>
</g>
<text x="${PAD}" y="${captionY}" fill="${t.title}" font-size="32" font-weight="600" letter-spacing="-.01em">${fmt(total)}<tspan dx="10" fill="${t.sub}" font-size="17" font-weight="400" letter-spacing="0">contributions in the last year</tspan></text>
<g font-size="11" fill="${t.foot}"><text x="${n(legendStart)}" y="${captionY - 1}" text-anchor="end">Less</text><text x="${W - PAD}" y="${captionY - 1}" text-anchor="end">More</text></g>
<g transform="scale(${n(pitch)})">${legendOrbs}</g>
</svg>
`;
}

const sheet = loadSheet();
const calendar = await settledCalendar(readToken());
mkdirSync(OUT, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const svg = render(calendar, sheet, theme);
  const path = join(OUT, `contrib-${theme}.svg`);
  writeFileSync(path, svg);
  console.log(`wrote ${path} (${Buffer.byteLength(svg)} bytes)`);
}
console.log(`${LOGIN}: ${fmt(calendar.total)} contributions over ${calendar.weeks.length} weeks`);
