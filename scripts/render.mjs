import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOGIN = "BatuCani";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const INK = "#0A0A0A";
const NAVY = "#1A2B47";
const BLUE = "#22437A";
const GLOW = "#488ADE";
const MIST = "#A9C8F2";
const LEVELS = [INK, NAVY, BLUE, GLOW, MIST];

const VW = 896;
const CELL = 9;
const GAP = 2;
const PITCH = CELL + GAP;
const ROWS = 7;
const DUR = 16;
const FONT = "ui-sans-serif, system-ui, sans-serif";

// Sheets are 10 frames, 192x256. Shown at about 60% of the previous 216x288.
// The kick toe on frame 06 sits at source pixel (184, 96). The planted sole is source y 240.
const SHOW_W = 130;
const SHOW_H = 173;
const SHEET_W = SHOW_W * 10;
const FOOT_X = (184 * SHOW_W) / 192;
const FOOT_Y = (96 * SHOW_H) / 256;
const SOLE = (240 * SHOW_H) / 256;
const KICK_Y = 186;

const ENTER = { file: "scene-enter.png", w: 1920, h: 256 };
const KICK = { file: "scene-kick.png", w: 1920, h: 256 };
const PAUSE = { file: "scene-pause.png", w: 1920, h: 256 };
const CHEER = { file: "scene-cheer.png", w: 1920, h: 256 };
const FACE = { file: "carbon-face.png", w: 160, h: 98 };

function readToken() {
  const fromEnv = process.env.GITHUB_TOKEN;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    console.error("Set GITHUB_TOKEN, or sign in so `gh auth token` can run.");
    process.exit(1);
  }
}

async function fetchCalendar(token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        login
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
                weekday
              }
            }
          }
        }
      }
    }
  `;
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "batu-profile-readme",
    },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  if (!response.ok) {
    console.error(`GitHub GraphQL answered HTTP ${response.status}.`);
    process.exit(1);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    console.error(payload.errors.map((error) => error.message).join("\n"));
    process.exit(1);
  }
  const user = payload.data?.user;
  const calendar = user?.contributionsCollection?.contributionCalendar;
  if (!user || !calendar?.weeks?.length) {
    console.error(`No contribution calendar for ${LOGIN}.`);
    process.exit(1);
  }
  return { login: user.login, calendar };
}

function thresholds(counts) {
  const positive = counts.filter((count) => count > 0).sort((a, b) => a - b);
  if (positive.length === 0) return [0, 0, 0];
  const at = (portion) => positive[Math.min(positive.length - 1, Math.floor((positive.length - 1) * portion))];
  let low = at(0.25);
  let mid = at(0.5);
  let high = at(0.75);
  if (low === high) {
    const max = positive[positive.length - 1];
    low = Math.max(1, Math.floor(max * 0.25));
    mid = Math.max(low + 1, Math.floor(max * 0.5));
    high = Math.max(mid + 1, Math.floor(max * 0.75));
  }
  return [low, mid, high];
}

function levelFor(count, [low, mid, high]) {
  if (count <= 0) return 0;
  if (count <= low) return 1;
  if (count <= mid) return 2;
  if (count <= high) return 3;
  return 4;
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]
  ));
}

function num(value) {
  return Number(value.toFixed(2)).toString();
}

function pct(seconds) {
  return (seconds / DUR) * 100;
}

function stamp(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function pngSize(buffer) {
  const png = buffer.length > 24 && buffer.toString("ascii", 1, 4) === "PNG";
  if (!png) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function loadAsset(spec) {
  const buffer = readFileSync(join(ROOT, "assets", spec.file));
  const size = pngSize(buffer);
  if (!size || size.width !== spec.w || size.height !== spec.h) {
    const got = size ? `${size.width}x${size.height}` : "not a png";
    console.error(`${spec.file} is ${got}, expected ${spec.w}x${spec.h}.`);
    process.exit(1);
  }
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function layout(columns) {
  const gridW = columns * CELL + (columns - 1) * GAP;
  const gridH = ROWS * CELL + (ROWS - 1) * GAP;
  const gx = (VW - gridW) / 2;
  const gy = KICK_Y - gridH / 2;
  const actorTop = KICK_Y - FOOT_Y;
  const kickY = KICK_Y;
  const countY = actorTop + SOLE + 56;
  const height = countY + 28;
  return { gridW, gridH, gx, gy, actorTop, kickY, countY, height };
}

function groupsFor(columns) {
  const cuts = [0.13, 0.26, 0.39, 0.52, 0.65, 0.8, 1];
  const impacts = [4.55, 5.55, 6.55, 7.55, 8.55, 9.55, 11.55];
  const power = [1, 1.12, 1.24, 1.36, 1.5, 1.65, 2.35];
  const edges = cuts.map((cut, index) => (
    index === cuts.length - 1 ? columns : Math.max(index + 1, Math.round(columns * cut))
  ));
  let start = 0;
  return edges.map((end, index) => {
    const group = {
      start,
      end: Math.max(start + 1, Math.min(columns, end)),
      impact: impacts[index],
      power: power[index],
      final: index === edges.length - 1,
    };
    start = group.end;
    return group;
  }).filter((group) => group.start < group.end);
}

function keyframes(name, stops) {
  const lines = stops.map(([at, body]) => {
    const label = at <= 0 ? "0%" : at >= 99.995 ? "100%" : `${num(at)}%`;
    return `      ${label} { ${body} }`;
  });
  return `    @keyframes ${name} {\n${lines.join("\n")}\n    }`;
}

function frameStops(samples) {
  const byTime = new Map();
  samples.forEach(([seconds, frame]) => {
    byTime.set(Math.round(pct(seconds) * 1000) / 1000, frame);
  });
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, frame]) => [at, `transform: translateX(${-frame * SHOW_W}px)`]);
}

function enterFrames() {
  const samples = [];
  const walkStep = 0.12;
  for (let step = 0; step < 20; step += 1) {
    const t = step * walkStep;
    samples.push([t, step % 4]);
  }
  const waveStep = 0.8 / 6;
  for (let step = 0; step < 12; step += 1) {
    samples.push([2.4 + step * waveStep, 4 + (step % 6)]);
  }
  samples.push([4, 0], [DUR, 0]);
  return keyframes("enter-frames", frameStops(samples));
}

function kickFrames() {
  const samples = [[0, 0]];
  const addCycle = (start) => {
    for (let frame = 0; frame < 10; frame += 1) samples.push([start + frame * 0.1, frame]);
  };
  // Six kicks, then the pause, then one heavier kick. Frame 9 is the guard.
  for (const start of [4, 5, 6, 7, 8, 9, 11]) addCycle(start);
  samples.push([12, 9], [DUR, 9]);
  return keyframes("kick-frames", frameStops(samples));
}

function columnMotion(column, group, place) {
  const hit = pct(group.impact + place * 0.03);
  const rise = hit + (group.final ? 1.3 : 1);
  const crest = hit + (group.final ? 3.4 : 2.6);
  const gone = Math.min(hit + (group.final ? 7.2 : 5.2), 97.5);
  const dir = column % 2 === 0 ? 1 : -1;
  const dx = (16 + (column % 5) * 6) * group.power;
  const lift = (14 + (column % 3) * 5) * Math.min(group.power, 1.55);
  const rot = (10 + (column % 4) * 4) * dir;
  return keyframes(`knock-${column}`, [
    [0, "transform: translate(0px, 0px) rotate(0deg) scale(1); opacity: 1; z-index: 1"],
    [hit, "transform: translate(0px, 0px) rotate(0deg) scale(1); opacity: 1; z-index: 1"],
    [rise, `transform: translate(${num(dx * 0.35)}px, -${num(lift)}px) rotate(${num(rot * 0.3)}deg) scale(1.18); opacity: 1; z-index: 6`],
    [crest, `transform: translate(${num(dx * 0.72)}px, -${num(lift * 0.35)}px) rotate(${num(rot * 0.7)}deg) scale(0.9); opacity: 0.7; z-index: 6`],
    [gone, `transform: translate(${num(dx)}px, ${num(group.final ? 46 : 28)}px) rotate(${num(rot)}deg) scale(0.28); opacity: 0; z-index: 6`],
    [97.5, `transform: translate(${num(dx)}px, ${num(group.final ? 46 : 28)}px) rotate(${num(rot)}deg) scale(0.28); opacity: 0; z-index: 6`],
    [100, "transform: translate(0px, 0px) rotate(0deg) scale(1); opacity: 1; z-index: 1"],
  ]) + `\n    .w-${column} { animation-name: knock-${column}; }`;
}

function burst(index, x, y, impact) {
  const start = pct(Math.max(0, impact - 0.05));
  const mid = pct(impact + 0.03);
  const end = pct(impact + 0.24);
  return {
    css: keyframes(`burst-${index}`, [
      [0, "opacity: 0; transform: scale(0.3)"],
      [start, "opacity: 0; transform: scale(0.3)"],
      [mid, "opacity: 0.95; transform: scale(1.35)"],
      [end, "opacity: 0; transform: scale(2.15)"],
      [100, "opacity: 0; transform: scale(2.15)"],
    ]) + `\n    .hit-${index} { animation-name: burst-${index}; }`,
    el: `<circle class="hit hit-${index}" cx="${num(x)}" cy="${num(y)}" r="16"/>`,
  };
}

function countSteps(total) {
  const steps = 8;
  const values = [];
  for (let i = 0; i < steps - 1; i += 1) {
    const t = i / (steps - 1);
    values.push(Math.round(total * (t ** 1.2)));
  }
  values.push(total);
  return values;
}

function contribSvg(calendar, sheets) {
  const weeks = calendar.weeks.map((week) => (
    [...week.contributionDays].sort((a, b) => a.weekday - b.weekday)
  ));
  const columns = weeks.length;
  const counts = weeks.flatMap((week) => week.map((day) => day.contributionCount));
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total !== calendar.totalContributions) {
    console.error(`Calendar sum ${total} does not match reported total ${calendar.totalContributions}.`);
    process.exit(1);
  }
  const scale = thresholds(counts);
  const box = layout(columns);
  const groups = groupsFor(columns);
  const first = weeks[0][0].date;
  const lastWeek = weeks[weeks.length - 1];
  const last = lastWeek[lastWeek.length - 1].date;
  const formatted = new Intl.NumberFormat("en-US").format(total);
  const range = `${stamp(first)} - ${stamp(last)}`;
  const colX = (column) => box.gx + column * PITCH + CELL / 2;
  const stand = (column) => colX(column) - FOOT_X;
  const off = -SHOW_W - 36;
  const home = stand(Math.min(columns - 1, Math.max(0, groups[0].end - 1)));

  const marks = [[0, off], [0.4, off + 48], [2.15, home]];
  groups.forEach((group, index) => {
    const x = stand(group.end - 1);
    if (index === 0) {
      marks.push([group.impact + 0.34, x]);
      return;
    }
    if (group.final) {
      // Stay for the last small kick, walk over during the pause, then plant.
      marks.push([10.15, stand(groups[index - 1].end - 1)]);
      marks.push([group.impact - 0.22, x]);
      marks.push([group.impact + 0.5, x]);
      return;
    }
    const arrive = Math.max(group.impact - 0.28, groups[index - 1].impact + 0.36);
    marks.push([arrive, x]);
    marks.push([group.impact + 0.34, x]);
  });
  marks.push([DUR, stand(groups[groups.length - 1].end - 1)]);
  const pathStops = [];
  marks.sort((a, b) => a[0] - b[0]).forEach(([time, x]) => {
    const at = pct(time);
    if (pathStops.length && at <= pathStops[pathStops.length - 1][0] + 0.04) return;
    pathStops.push([at, `transform: translate(${num(x)}px, ${box.actorTop}px)`]);
  });
  if (pathStops[pathStops.length - 1][0] < 100) {
    pathStops.push([100, pathStops[pathStops.length - 1][1]]);
  }

  const owned = new Array(columns).fill(null);
  groups.forEach((group) => {
    for (let column = group.start; column < group.end && column < columns; column += 1) {
      owned[column] = { group, place: column - group.start };
    }
  });

  const cells = weeks.map((week, column) => {
    const owner = owned[column] || { group: groups[groups.length - 1], place: 0 };
    return week.map((day) => {
      const level = levelFor(day.contributionCount, scale);
      const x = box.gx + column * PITCH;
      const y = box.gy + day.weekday * PITCH;
      const fade = level === 0 ? ` fill-opacity="0.72"` : "";
      const fill = level === 0 ? NAVY : LEVELS[level];
      return `<rect class="cell w-${column}" x="${num(x)}" y="${num(y)}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}"${fade}><title>${xml(day.date)}: ${day.contributionCount}</title></rect>`;
    }).join("");
  }).join("");

  for (let column = 0; column < columns; column += 1) {
    if (!owned[column]) owned[column] = { group: groups[groups.length - 1], place: 0 };
  }
  const motions = owned.map((owner, column) => columnMotion(column, owner.group, owner.place)).join("\n");
  const hits = groups.map((group, index) => burst(
    index,
    colX(group.end - 1),
    box.kickY,
    group.impact,
  ));

  const steps = countSteps(total);
  const countStart = 12;
  const countSpan = 2.2;
  const countCss = steps.map((value, index) => {
    const on = pct(countStart + (countSpan * index) / steps.length);
    const off = index === steps.length - 1
      ? 99
      : pct(countStart + (countSpan * (index + 1)) / steps.length);
    const name = `count-${index}`;
    const stops = [
      [0, "opacity: 0"],
      [on, "opacity: 1"],
      [off, "opacity: 0"],
      [100, "opacity: 0"],
    ];
    return keyframes(name, stops) + `\n    .n-${index} { animation-name: ${name}; }`;
  }).join("\n");
  const numbers = steps.map((value, index) => {
    const label = new Intl.NumberFormat("en-US").format(value);
    const final = index === steps.length - 1 ? " n-final" : "";
    return `<text class="n n-${index}${final}" x="${num(box.gx)}" y="${num(box.countY)}">${xml(label)}</text>`;
  }).join("");

  const restX = stand(Math.floor((columns - 1) / 2));
  const legendRight = box.gx + box.gridW;
  const squarePitch = 14;
  const squaresW = 4 * squarePitch + 10;
  const squaresX = legendRight - squaresW;
  const legendSquares = [NAVY, NAVY, BLUE, GLOW, MIST].map((fill, index) => {
    const x = squaresX + index * squarePitch;
    const fade = index === 0 ? ` fill-opacity="0.72"` : "";
    return `<rect x="${num(x)}" y="${num(box.countY - 18)}" width="10" height="10" rx="2" fill="${fill}"${fade}/>`;
  }).join("");

  const show = (name, offAt, onAt = null, offAt2 = null, onAt2 = null) => {
    const stops = [[0, onAt === null ? "opacity: 1" : "opacity: 0"]];
    if (onAt !== null) stops.push([onAt, "opacity: 1"]);
    stops.push([offAt, "opacity: 0"]);
    if (onAt2 !== null) stops.push([onAt2, "opacity: 1"]);
    if (offAt2 !== null) stops.push([offAt2, "opacity: 0"]);
    stops.push([100, "opacity: 0"]);
    return keyframes(`show-${name}`, stops);
  };

  const sheet = (cls, href) => (
    `<image class="sheet ${cls}" href="${href}" x="0" y="0" width="${SHEET_W}" height="${SHOW_H}"/>`
  );

  const style = `
    text { font-family: ${FONT}; }
    .cell, .hit {
      transform-box: fill-box;
      transform-origin: center;
      animation-duration: ${DUR}s;
      animation-timing-function: step-end;
      animation-iteration-count: infinite;
    }
    .cell { z-index: 1; animation-timing-function: linear; }
    .hit { fill: ${MIST}; stroke: ${MIST}; stroke-width: 2; animation-timing-function: linear; }
    .actor {
      overflow: hidden;
      animation: path ${DUR}s ease-in-out infinite;
    }
    .sheet { transform-box: fill-box; }
    .enter { animation: show-enter ${DUR}s step-end infinite, enter-frames ${DUR}s step-end infinite; }
    .kick { animation: show-kick ${DUR}s step-end infinite, kick-frames ${DUR}s step-end infinite; }
    .pause { animation: show-pause ${DUR}s step-end infinite, pause-frames 1s steps(10, jump-end) infinite; }
    .cheer { animation: show-cheer ${DUR}s step-end infinite, cheer-frames 1.6s steps(10, jump-end) infinite; }
    .cheer-hop { animation: hop ${DUR}s ease-in-out infinite; }
    .n, .year-label {
      opacity: 0;
      animation-duration: ${DUR}s;
      animation-timing-function: step-end;
      animation-iteration-count: infinite;
    }
    .n {
      fill: ${MIST};
      font-size: 40px;
      font-weight: 600;
    }
    .year-label { animation-name: year-label; }
    ${show("enter", 25)}
    ${show("kick", 62.5, 25, 90, 68.75)}
    ${show("pause", 68.75, 62.5)}
    ${show("cheer", 99, 90)}
    ${enterFrames()}
    ${kickFrames()}
    @keyframes pause-frames { from { transform: translateX(0); } to { transform: translateX(${-SHEET_W}px); } }
    @keyframes cheer-frames { from { transform: translateX(0); } to { transform: translateX(${-SHEET_W}px); } }
    ${keyframes("path", pathStops)}
    ${keyframes("hop", [
      [0, "transform: translateY(0)"],
      [91.5, "transform: translateY(0)"],
      [92.6, "transform: translateY(-12px)"],
      [94.2, "transform: translateY(-12px)"],
      [95.4, "transform: translateY(0)"],
      [100, "transform: translateY(0)"],
    ])}
    ${motions}
    ${hits.map((hit) => hit.css).join("\n")}
    ${countCss}
    ${keyframes("year-label", [
      [0, "opacity: 0"],
      [pct(countStart), "opacity: 1"],
      [99, "opacity: 1"],
      [100, "opacity: 0"],
    ])}
    @media (prefers-reduced-motion: reduce) {
      .cell, .actor, .sheet, .hit, .n, .year-label, .cheer-hop { animation: none; }
      .sheet { opacity: 0; }
      .enter { opacity: 1; transform: translateX(${-9 * SHOW_W}px); }
      .actor { transform: translate(${num(restX)}px, ${box.actorTop}px); }
      .n, .year-label { opacity: 1; }
      .n { opacity: 0; }
      .n-final, .year-label { opacity: 1; }
      .cheer-hop { transform: none; }
    }
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${VW}" height="${num(box.height)}" viewBox="0 0 ${VW} ${num(box.height)}" role="img" font-family="${FONT}">
  <title>Contributions</title>
  <desc>${xml(`${formatted} contributions from ${range}. Carbon jogs in, kicks the weeks away, and cheers.`)}</desc>
  <style>${style}</style>
  <rect width="${VW}" height="${num(box.height)}" fill="${INK}"/>
  <text x="${num(box.gx)}" y="32" fill="${GLOW}" font-size="12" letter-spacing="0.16em">CONTRIBUTIONS</text>
  <text x="${num(legendRight)}" y="32" fill="${BLUE}" font-size="12" text-anchor="end">${xml(range)}</text>
  <rect x="${num(box.gx - 10)}" y="${num(box.gy - 10)}" width="${num(box.gridW + 20)}" height="${num(box.gridH + 20)}" rx="10" fill="${INK}" stroke="${NAVY}" stroke-width="1"/>
  ${cells}
  ${hits.map((hit) => hit.el).join("")}
  <svg class="actor" x="0" y="0" width="${SHOW_W}" height="${SHOW_H}" overflow="hidden">
    ${sheet("enter", sheets.enter)}
    ${sheet("kick", sheets.kick)}
    ${sheet("pause", sheets.pause)}
    <g class="cheer-hop">${sheet("cheer", sheets.cheer)}</g>
  </svg>
  ${numbers}
  <text class="year-label" x="${num(box.gx)}" y="${num(box.countY + 20)}" fill="${GLOW}" font-size="14">contributions in the last year</text>
  <text x="${num(squaresX - 8)}" y="${num(box.countY - 9)}" fill="${GLOW}" font-size="11" text-anchor="end">less</text>
  ${legendSquares}
  <text x="${num(legendRight)}" y="${num(box.countY - 9)}" fill="${GLOW}" font-size="11" text-anchor="end">more</text>
</svg>
`;
}

function projectsSvg(faceUri) {
  const cards = [
    ["01", "Glovio AI", "AI boxing coach"],
    ["02", "Clipper", "Long video to shorts"],
    ["03", "Portfolio", "Photo and video"],
    ["04", "Training OS", "Athletics dashboard"],
  ];
  const cardW = 212;
  const cardH = 132;
  const gap = 16;
  const faceW = 46;
  const faceH = num(faceW * FACE.h / FACE.w);
  const bodies = cards.map((card, index) => {
    const x = index * (cardW + gap);
    const mark = index === 0
      ? `<image href="${faceUri}" x="22" y="22" width="${faceW}" height="${faceH}"/>`
      : "";
    const textX = index === 0 ? 78 : 22;
    return `
    <g transform="translate(${x} 0)">
      <rect width="${cardW}" height="${cardH}" rx="18" fill="${INK}" stroke="${NAVY}" stroke-width="1"/>
      <text x="${cardW - 18}" y="28" fill="${BLUE}" font-size="11" text-anchor="end">${card[0]}</text>
      ${mark}
      <text x="${textX}" y="78" fill="${MIST}" font-size="16" font-weight="600">${xml(card[1])}</text>
      <path d="M ${textX} 90 H ${textX + 28}" stroke="${BLUE}" stroke-width="1.5" stroke-linecap="round"/>
      <text x="${textX}" y="112" fill="${GLOW}" font-size="13">${xml(card[2])}</text>
    </g>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${VW}" height="${cardH}" viewBox="0 0 ${VW} ${cardH}" role="img" font-family="${FONT}">
  <title>Projects</title>
  <desc>Glovio AI, Clipper, Portfolio, and Training OS.</desc>
  <style>text { font-family: ${FONT}; }</style>
  <rect width="${VW}" height="${cardH}" fill="${INK}"/>
  ${bodies}
</svg>
`;
}

const token = readToken();
const sheets = {
  enter: loadAsset(ENTER),
  kick: loadAsset(KICK),
  pause: loadAsset(PAUSE),
  cheer: loadAsset(CHEER),
};
const face = loadAsset(FACE);
const { login, calendar } = await fetchCalendar(token);
const contrib = contribSvg(calendar, sheets);
const projects = projectsSvg(face);
mkdirSync(DIST, { recursive: true });
const contribPath = join(DIST, "contrib.svg");
const projectsPath = join(DIST, "projects.svg");
writeFileSync(contribPath, contrib);
writeFileSync(projectsPath, projects);
const days = calendar.weeks.reduce((sum, week) => sum + week.contributionDays.length, 0);
console.log(`rendered ${login}`);
console.log(`contributions ${calendar.totalContributions}`);
console.log(`weeks ${calendar.weeks.length}`);
console.log(`days ${days}`);
console.log(`wrote ${contribPath}`);
console.log(`wrote ${projectsPath}`);
console.log(`contrib bytes ${Buffer.byteLength(contrib)}`);
console.log(`projects bytes ${Buffer.byteLength(projects)}`);
