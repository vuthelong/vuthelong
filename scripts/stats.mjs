import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GH_TOKEN;
const USER = process.env.GH_USER || 'vuthelong';
const YEAR = Number(process.env.YEAR) || new Date().getUTCFullYear();
const SNAPSHOT = /-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

if (!TOKEN) {
  console.error('GH_TOKEN is required');
  process.exit(1);
}

const api = async (path) => {
  const out = [];
  let url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (res.status === 404 || res.status === 409) return null;
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const body = await res.json();
    if (!Array.isArray(body)) return body;
    out.push(...body);
    url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return out;
};

const all = await api('/user/repos?affiliation=owner&per_page=100');
const repos = all.filter((r) =>
  r.owner.login === USER && !r.fork && r.name !== USER && !SNAPSHOT.test(r.name) && new Date(r.created_at).getUTCFullYear() === YEAR);

const days = {};
const list = [];
for (const r of repos) {
  const commits = (await api(`/repos/${USER}/${r.name}/commits?since=${YEAR}-01-01T00:00:00Z&per_page=100`)) ?? [];
  for (const c of commits) {
    const d = c.commit.committer.date.slice(0, 10);
    if (d.startsWith(String(YEAR))) days[d] = (days[d] || 0) + 1;
  }
  const rel = await api(`/repos/${USER}/${r.name}/releases/latest`);
  list.push({
    name: r.name,
    private: r.private,
    language: r.language,
    created: r.created_at.slice(0, 10),
    pushed: r.pushed_at.slice(0, 10),
    commits: commits.length,
    version: rel?.tag_name?.replace(/^v/, '') ?? null,
  });
}

const total = { repos: list.length, commits: list.reduce((n, r) => n + r.commits, 0) };
const updated = new Date().toISOString().slice(0, 10);
const sortedDays = Object.fromEntries(Object.entries(days).sort());

const fmt = (n) => n.toLocaleString('en-US');
const versions = Object.fromEntries(list.filter((r) => r.version).map((r) => [r.name, r.version]));

const htmlPath = join(ROOT, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const setStat = (key, value) => {
  html = html.replace(new RegExp(`(data-stat="${key}"[^>]*>)[^<]*(<)`, 'g'), `$1${value}$2`);
};
setStat('repos', fmt(total.repos));
setStat('commits', fmt(total.commits));
setStat('year', YEAR);
setStat('updated', updated);
for (const [name, v] of Object.entries(versions)) setStat(`v-${name}`, v);
html = html.replace(
  /(<script id="activity-data" type="application\/json">)[\s\S]*?(<\/script>)/,
  `$1${JSON.stringify({ year: YEAR, updated, days: sortedDays })}$2`,
);
writeFileSync(htmlPath, html);

const readmePath = join(ROOT, 'README.md');
let readme = readFileSync(readmePath, 'utf8');
readme = readme.replace(/\*\*\d{4}:\*\* [\d,]+ repos · [\d,]+ commits/, `**${YEAR}:** ${fmt(total.repos)} repos · ${fmt(total.commits)} commits`);
const tools = { 'K-Folders': 'KFolders', 'K-Hierarchy': 'KHierarchy', 'K-Inspector': 'KInspector', 'K-Favorites': 'KFavorites', 'K-Tabs': 'KTabs', 'K-Emoji': 'KEmoji', 'K-Clipboard': 'KClipboard', 'K-Scene': 'KScene', 'K-Setting': 'KSetting' };
for (const [label, repo] of Object.entries(tools)) {
  if (!versions[repo]) continue;
  readme = readme.replace(new RegExp(`^(\\| \\[?\\*\\*${label}\\*\\*.*\\| )[^|]+?( \\|)$`, 'm'), `$1${versions[repo]}$2`);
}
writeFileSync(readmePath, readme);

console.log(`${total.repos} repos, ${total.commits} commits, ${Object.keys(days).length} active days`);
