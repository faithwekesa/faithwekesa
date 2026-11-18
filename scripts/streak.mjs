import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LOGIN = process.env.LOGIN || "faithwekesa";
const TOKEN = process.env.GH_TOKEN;
const OUT = process.env.OUT || "streak.svg";

const QUERY = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){createdAt contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;

async function gql(variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "streak-card" },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

async function fetchDays() {
  const now = new Date();
  const probe = await gql({ login: LOGIN, from: new Date(now.getTime() - 86400000).toISOString(), to: now.toISOString() });
  const startYear = new Date(probe.createdAt).getUTCFullYear();
  const map = new Map();
  for (let y = startYear; y <= now.getUTCFullYear(); y++) {
    const from = new Date(Date.UTC(y, 0, 1));
    const to = y === now.getUTCFullYear() ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59));
    const user = await gql({ login: LOGIN, from: from.toISOString(), to: to.toISOString() });
    for (const week of user.contributionsCollection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) map.set(day.date, day.contributionCount);
    }
  }
  return map;
}

export function compute(map, today) {
  const days = [...map.entries()].filter(([d]) => d <= today).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const total = days.reduce((sum, [, c]) => sum + c, 0);
  const firstDay = (days.find(([, c]) => c > 0) || [today])[0];
  let longest = { len: 0, start: null, end: null };
  let run = 0;
  let runStart = null;
  for (const [d, c] of days) {
    if (c > 0) {
      if (run === 0) runStart = d;
      run++;
      if (run > longest.len) longest = { len: run, start: runStart, end: d };
    } else {
      run = 0;
    }
  }
  let i = days.length - 1;
  if (i >= 0 && days[i][0] === today && days[i][1] === 0) i--;
  const current = { len: 0, start: null, end: null };
  while (i >= 0 && days[i][1] > 0) {
    if (current.len === 0) current.end = days[i][0];
    current.len++;
    current.start = days[i][0];
    i--;
  }
  return { total, firstDay, longest, current };
}

function fmt(d, today) {
  const date = new Date(d + "T00:00:00Z");
  const opts = { month: "short", day: "numeric", timeZone: "UTC" };
  if (d.slice(0, 4) !== today.slice(0, 4)) opts.year = "numeric";
  return date.toLocaleDateString("en-US", opts);
}

function range(s, today) {
  if (!s.len) return "No streak yet";
  if (s.start === s.end) return fmt(s.start, today);
  return `${fmt(s.start, today)} - ${fmt(s.end, today)}`;
}

export function render(stats, today) {
  const { total, firstDay, longest, current } = stats;
  const font = "'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif";
  const col = (x, number, label, sub, labelColor) => `
    <text x="${x}" y="88" text-anchor="middle" font-size="28" font-weight="700" fill="#70a5fd">${number}</text>
    <text x="${x}" y="122" text-anchor="middle" font-size="14" fill="${labelColor}">${label}</text>
    <text x="${x}" y="146" text-anchor="middle" font-size="11" fill="#38bdae">${sub}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="Contribution streak">
  <rect width="495" height="195" rx="4.5" fill="#1a1b27"/>
  <g font-family="${font}">
    <line x1="165" y1="28" x2="165" y2="167" stroke="#e4e2e2" stroke-opacity="0.25"/>
    <line x1="330" y1="28" x2="330" y2="167" stroke="#e4e2e2" stroke-opacity="0.25"/>
    ${col(82.5, total.toLocaleString("en-US"), "Total Contributions", `${fmt(firstDay, today)} - Present`, "#70a5fd")}
    ${col(412.5, longest.len, "Longest Streak", range(longest, today), "#70a5fd")}
    <circle cx="247.5" cy="71" r="40" fill="none" stroke="#70a5fd" stroke-width="5"/>
    <circle cx="247.5" cy="29" r="11" fill="#1a1b27"/>
    <path d="M247.5 19 C253 25 255 30 251.5 35 C250 37 245 37 243.5 35 C240 30 244 25 247.5 19Z" fill="#70a5fd"/>
    <text x="247.5" y="82" text-anchor="middle" font-size="28" font-weight="700" fill="#bf91f3">${current.len}</text>
    <text x="247.5" y="140" text-anchor="middle" font-size="14" font-weight="700" fill="#bf91f3">Current Streak</text>
    <text x="247.5" y="162" text-anchor="middle" font-size="11" fill="#38bdae">${range(current, today)}</text>
  </g>
</svg>
`;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const map = process.env.DEMO ? demo(today) : await fetchDays();
  writeFileSync(OUT, render(compute(map, today), today));
}

function demo(today) {
  const map = new Map();
  const end = new Date(today + "T00:00:00Z");
  for (let i = 400; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
    map.set(d, i % 9 === 0 || (i > 60 && i < 75) ? 0 : 3);
  }
  return map;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
