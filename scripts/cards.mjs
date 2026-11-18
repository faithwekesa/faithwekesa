import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LOGIN = process.env.LOGIN || "faithwekesa";
const TOKEN = process.env.GH_TOKEN;
const OUT_DIR = process.env.OUT_DIR || ".";
const EXCLUDE_REPOS = ["titanic-data", "machine-learning"];
const HIDE_LANGS = ["Jupyter Notebook"];

const BG = "#1a1b27";
const BLUE = "#70a5fd";
const PURPLE = "#bf91f3";
const TEAL = "#38bdae";
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif";

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-cards" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

const CALENDAR = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){createdAt contributionsCollection(from:$from,to:$to){contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`;

const OVERVIEW = `query($login:String!){user(login:$login){
  pullRequests{totalCount}
  issues{totalCount}
  publicRepos: repositories(privacy:PUBLIC,ownerAffiliations:OWNER){totalCount}
  repositoriesContributedTo(first:1,contributionTypes:[COMMIT,PULL_REQUEST,ISSUE,REPOSITORY]){totalCount}
  repositories(first:100,ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC){nodes{name stargazerCount languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{name color}}}}}
}}`;

async function fetchDays() {
  const now = new Date();
  const probe = await gql(CALENDAR, { login: LOGIN, from: new Date(now.getTime() - 86400000).toISOString(), to: now.toISOString() });
  const startYear = new Date(probe.createdAt).getUTCFullYear();
  const map = new Map();
  for (let y = startYear; y <= now.getUTCFullYear(); y++) {
    const from = new Date(Date.UTC(y, 0, 1));
    const to = y === now.getUTCFullYear() ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59));
    const user = await gql(CALENDAR, { login: LOGIN, from: from.toISOString(), to: to.toISOString() });
    for (const week of user.contributionsCollection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) map.set(day.date, day.contributionCount);
    }
  }
  return map;
}

async function fetchOverview() {
  const u = await gql(OVERVIEW, { login: LOGIN });
  const repos = u.repositories.nodes;
  const bytes = new Map();
  for (const repo of repos) {
    if (EXCLUDE_REPOS.includes(repo.name)) continue;
    for (const e of repo.languages.edges) {
      if (HIDE_LANGS.includes(e.node.name)) continue;
      const cur = bytes.get(e.node.name) || { size: 0, color: e.node.color || "#8b949e" };
      cur.size += e.size;
      bytes.set(e.node.name, cur);
    }
  }
  const languages = [...bytes.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.size - a.size);
  return {
    stars: repos.reduce((s, r) => s + r.stargazerCount, 0),
    prs: u.pullRequests.totalCount,
    issues: u.issues.totalCount,
    publicRepos: u.publicRepos.totalCount,
    contributedTo: u.repositoriesContributedTo.totalCount,
    languages,
  };
}

export function compute(map, today) {
  const days = [...map.entries()].filter(([d]) => d <= today).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const total = days.reduce((sum, [, c]) => sum + c, 0);
  const lastYearStart = new Date(new Date(today + "T00:00:00Z").getTime() - 364 * 86400000).toISOString().slice(0, 10);
  const lastYear = days.filter(([d]) => d >= lastYearStart).reduce((sum, [, c]) => sum + c, 0);
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
  return { total, lastYear, firstDay, longest, current };
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

const num = (n) => n.toLocaleString("en-US");
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function renderStreak(stats, today) {
  const { total, firstDay, longest, current } = stats;
  const col = (x, number, label, sub) => `
    <text x="${x}" y="88" text-anchor="middle" font-size="28" font-weight="700" fill="${BLUE}">${number}</text>
    <text x="${x}" y="122" text-anchor="middle" font-size="14" fill="${BLUE}">${label}</text>
    <text x="${x}" y="146" text-anchor="middle" font-size="11" fill="${TEAL}">${sub}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="Contribution streak">
  <rect width="495" height="195" rx="4.5" fill="${BG}"/>
  <g font-family="${FONT}">
    <line x1="165" y1="28" x2="165" y2="167" stroke="#e4e2e2" stroke-opacity="0.25"/>
    <line x1="330" y1="28" x2="330" y2="167" stroke="#e4e2e2" stroke-opacity="0.25"/>
    ${col(82.5, num(total), "Total Contributions", `${fmt(firstDay, today)} - Present`)}
    ${col(412.5, longest.len, "Longest Streak", range(longest, today))}
    <circle cx="247.5" cy="71" r="40" fill="none" stroke="${BLUE}" stroke-width="5"/>
    <circle cx="247.5" cy="29" r="11" fill="${BG}"/>
    <path d="M247.5 18 C252 24 256 28 253 33 C251.500 36 249 37 247.500 37 C246 37 243.500 36 242 33 C239 28 243.500 24 247.500 18Z" fill="${BLUE}"/>
    <text x="247.5" y="82" text-anchor="middle" font-size="28" font-weight="700" fill="${PURPLE}">${current.len}</text>
    <text x="247.5" y="140" text-anchor="middle" font-size="14" font-weight="700" fill="${PURPLE}">Current Streak</text>
    <text x="247.5" y="162" text-anchor="middle" font-size="11" fill="${TEAL}">${range(current, today)}</text>
  </g>
</svg>
`;
}

export function renderStats(o, lastYear) {
  const rows = [
    ["Total Stars Earned", o.stars],
    ["Pull Requests", o.prs],
    ["Issues", o.issues],
    ["Repos Contributed To", o.contributedTo],
    ["Public Repositories", o.publicRepos],
  ];
  const lines = rows
    .map(([label, value], i) => `
    <text x="25" y="${72 + i * 24}" font-size="14" fill="${TEAL}">${label}:</text>
    <text x="235" y="${72 + i * 24}" text-anchor="end" font-size="14" font-weight="700" fill="${TEAL}">${num(value)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="GitHub stats">
  <rect width="495" height="195" rx="4.5" fill="${BG}"/>
  <g font-family="${FONT}">
    <text x="25" y="35" font-size="18" font-weight="600" fill="${BLUE}">faithwekesa's GitHub Stats</text>${lines}
    <circle cx="395" cy="105" r="50" fill="none" stroke="${BLUE}" stroke-width="5"/>
    <text x="395" y="106" text-anchor="middle" font-size="26" font-weight="700" fill="${BLUE}">${num(lastYear)}</text>
    <text x="395" y="126" text-anchor="middle" font-size="10" fill="${TEAL}">contributions</text>
    <text x="395" y="139" text-anchor="middle" font-size="10" fill="${TEAL}">in the last year</text>
  </g>
</svg>
`;
}

export function renderLanguages(languages) {
  const top = languages.slice(0, 6);
  const sum = top.reduce((s, l) => s + l.size, 0) || 1;
  let x = 25;
  const bar = top
    .map((l) => {
      const w = (l.size / sum) * 250;
      const seg = `<rect x="${x.toFixed(2)}" y="56" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("");
  const legend = top
    .map((l, i) => {
      const cx = i % 2 === 0 ? 25 : 155;
      const cy = 92 + Math.floor(i / 2) * 25;
      return `
    <circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${l.color}"/>
    <text x="${cx + 16}" y="${cy}" font-size="11" fill="${TEAL}">${esc(l.name)} ${((l.size / sum) * 100).toFixed(2)}%</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="165" viewBox="0 0 300 165" role="img" aria-label="Most used languages">
  <rect width="300" height="165" rx="4.5" fill="${BG}"/>
  <clipPath id="c"><rect x="25" y="56" width="250" height="8" rx="4"/></clipPath>
  <g font-family="${FONT}">
    <text x="25" y="35" font-size="18" font-weight="600" fill="${BLUE}">Most Used Languages</text>
    <g clip-path="url(#c)">${bar}</g>${legend}
  </g>
</svg>
`;
}

function demo(today) {
  const map = new Map();
  const end = new Date(today + "T00:00:00Z");
  for (let i = 400; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
    map.set(d, i % 9 === 0 || (i > 60 && i < 75) ? 0 : 3);
  }
  const overview = {
    stars: 0, prs: 9, issues: 0, publicRepos: 44, contributedTo: 12,
    languages: [
      { name: "TypeScript", size: 40, color: "#3178c6" },
      { name: "CSS", size: 30, color: "#663399" },
      { name: "JavaScript", size: 20, color: "#f1e05a" },
      { name: "Python", size: 15, color: "#3572A5" },
      { name: "HTML", size: 6, color: "#e34c26" },
      { name: "MDX", size: 4, color: "#fcb32c" },
    ],
  };
  return { map, overview };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const { map, overview } = process.env.DEMO ? demo(today) : { map: await fetchDays(), overview: await fetchOverview() };
  const stats = compute(map, today);
  writeFileSync(`${OUT_DIR}/streak.svg`, renderStreak(stats, today));
  writeFileSync(`${OUT_DIR}/stats.svg`, renderStats(overview, stats.lastYear));
  writeFileSync(`${OUT_DIR}/languages.svg`, renderLanguages(overview.languages));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
