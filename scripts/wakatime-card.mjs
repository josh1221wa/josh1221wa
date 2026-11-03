// Builds a WakaTime stats card (SVG) styled after the portfolio.
// Reads the user's *public* WakaTime stats, so no API key is needed.
//
//   node scripts/wakatime-card.mjs [output.svg]
//
// Env: WAKATIME_USER (default josh_wa), WAKATIME_RANGE (default last_year;
// must match the range made public on wakatime.com/settings/profile).

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const USER = process.env.WAKATIME_USER || "josh_wa";
const RANGE = process.env.WAKATIME_RANGE || "last_year";
const OUT = process.argv[2] || "dist/wakatime.svg";

// Data/config/docs formats that inflate totals but aren't "code".
const IGNORED = new Set([
  "JSON", "Markdown", "Other", "Text", "Git Config", "CSV", "Diff", "YAML",
  "TOML", "INI", "XML", "Log", "Image (png)", "Image (svg)", "Ignore List", "Mail",
]);
const LANG_COUNT = 6;

const RANGE_LABEL = {
  last_7_days: "LAST 7 DAYS",
  last_30_days: "LAST 30 DAYS",
  last_6_months: "LAST 6 MONTHS",
  last_year: "LAST 12 MONTHS",
  all_time: "ALL TIME",
};

const C = {
  bg: "#0A0A0A", border: "#1F1F1F", track: "#161616",
  text: "#F0F0F0", muted: "#8A8A8A", dim: "#555", accent: "#4ADE80",
};
const EDITOR_SHADES = ["#4ADE80", "#22A355", "#166534", "#0E3B22"];
const MONO = "'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";
const SANS = "Inter,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtHours = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

async function fetchStats() {
  const url = `https://wakatime.com/api/v1/users/@${USER}/stats/${RANGE}`;
  const res = await fetch(url, { headers: { "User-Agent": "josh1221wa-profile-card" } });
  if (!res.ok) throw new Error(`WakaTime responded ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  if (!data?.languages?.length) throw new Error("WakaTime returned no language data (stats may still be computing)");
  return data;
}

function render(d) {
  const W = 1200;
  const PAD = 48;

  const langs = d.languages.filter((l) => !IGNORED.has(l.name));
  const codeSeconds = langs.reduce((s, l) => s + l.total_seconds, 0);
  const top = langs.slice(0, LANG_COUNT).map((l) => ({ ...l, share: (l.total_seconds / codeSeconds) * 100 }));

  const editors = d.editors.filter((e) => e.total_seconds > 0 && e.name !== "Unknown Editor");
  const edSeconds = editors.reduce((s, e) => s + e.total_seconds, 0);
  const edTop = editors
    .map((e) => ({ name: e.name, share: (e.total_seconds / edSeconds) * 100 }))
    .filter((e) => e.share >= 1)
    .slice(0, 3);
  const edRest = 100 - edTop.reduce((s, e) => s + e.share, 0);
  if (edRest >= 0.5) edTop.push({ name: "Other", share: edRest });

  const stats = [
    ["TOTAL_TRACKED", d.human_readable_total_including_other_language],
    ["DAILY_AVG", d.human_readable_daily_average_including_other_language || d.human_readable_daily_average],
    ["TOP_LANGUAGE", top[0]?.name ?? "—"],
    ["MAIN_EDITOR", edTop[0]?.name ?? "—"],
  ];

  let y = 0;
  const parts = [];

  // header
  y = 52;
  parts.push(
    `<text x="${PAD}" y="${y}" font-family="${MONO}" font-size="15" letter-spacing="2" fill="${C.accent}">[ 0x04 ]  <tspan fill="${C.text}">CODE_TIME</tspan></text>`,
    `<text x="${W - PAD}" y="${y}" font-family="${MONO}" font-size="12" letter-spacing="1.5" fill="${C.dim}" text-anchor="end">SRC: WAKATIME  ·  ${RANGE_LABEL[RANGE] ?? RANGE.toUpperCase()}</text>`,
    `<line x1="${PAD}" y1="${y + 20}" x2="${W - PAD}" y2="${y + 20}" stroke="${C.border}"/>`,
  );

  // stat tiles
  y = 112;
  const colW = (W - PAD * 2) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = PAD + i * colW;
    parts.push(
      `<text x="${x}" y="${y}" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${C.dim}">${esc(label)}</text>`,
      `<text x="${x}" y="${y + 34}" font-family="${SANS}" font-size="26" font-weight="600" fill="${C.text}">${esc(value)}</text>`,
    );
  });

  // languages
  y = 206;
  parts.push(
    `<text x="${PAD}" y="${y}" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${C.dim}">LANGUAGES  <tspan fill="#444">// share of code time, excl. config &amp; docs</tspan></text>`,
  );
  const nameW = 170, timeW = 110, pctW = 70;
  const barX = PAD + nameW, barW = W - PAD * 2 - nameW - timeW - pctW;
  top.forEach((l, i) => {
    const ry = y + 30 + i * 30;
    const w = Math.max(2, (barW * l.share) / 100);
    parts.push(
      `<text x="${PAD}" y="${ry + 5}" font-family="${MONO}" font-size="14" fill="${i === 0 ? C.text : "#C8C8C8"}">${esc(l.name)}</text>`,
      `<rect x="${barX}" y="${ry - 5}" width="${barW}" height="10" rx="1" fill="${C.track}"/>`,
      `<rect x="${barX}" y="${ry - 5}" width="${w.toFixed(1)}" height="10" rx="1" fill="${C.accent}" fill-opacity="${(1 - i * 0.13).toFixed(2)}"/>`,
      `<text x="${barX + barW + 24}" y="${ry + 5}" font-family="${MONO}" font-size="13" fill="${C.muted}">${fmtHours(l.total_seconds)}</text>`,
      `<text x="${W - PAD}" y="${ry + 5}" font-family="${MONO}" font-size="13" fill="${C.text}" text-anchor="end">${l.share.toFixed(1)}%</text>`,
    );
  });
  y += 30 + top.length * 30 + 22;

  // editors: one stacked bar + legend
  parts.push(
    `<text x="${PAD}" y="${y}" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${C.dim}">EDITORS</text>`,
  );
  const sbY = y + 18, sbW = W - PAD * 2;
  let sx = PAD;
  edTop.forEach((e, i) => {
    const w = (sbW * e.share) / 100;
    parts.push(`<rect x="${sx.toFixed(1)}" y="${sbY}" width="${Math.max(1, w - 2).toFixed(1)}" height="10" fill="${EDITOR_SHADES[i] ?? "#333"}"/>`);
    sx += w;
  });
  let lx = PAD;
  const legendY = sbY + 38;
  edTop.forEach((e, i) => {
    const label = `${e.name}  ${e.share.toFixed(1)}%`;
    parts.push(
      `<rect x="${lx}" y="${legendY - 9}" width="10" height="10" fill="${EDITOR_SHADES[i] ?? "#333"}"/>`,
      `<text x="${lx + 18}" y="${legendY}" font-family="${MONO}" font-size="13" fill="${C.muted}">${esc(label)}</text>`,
    );
    lx += 18 + label.length * 8.2 + 36;
  });
  y = legendY + 34;

  // footer
  const updated = new Date().toISOString().slice(0, 10);
  parts.push(
    `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${C.border}"/>`,
    `<text x="${PAD}" y="${y + 20}" font-family="${MONO}" font-size="11" letter-spacing="1.2" fill="${C.dim}">LAST_SYNC: ${updated}  <tspan fill="${C.accent}">[OK]</tspan></text>`,
  );
  const H = y + 36;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="WakaTime coding stats: ${esc(stats[0][1])} tracked, top language ${esc(stats[2][1])}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${C.border}"/>
  ${parts.join("\n  ")}
</svg>
`;
}

const data = await fetchStats();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, render(data));
console.log(`Wrote ${OUT}`);
