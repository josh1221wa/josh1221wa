// Builds the "stack" icon row from what's actually in my public repos:
// GitHub's language byte counts, plus imports/dependencies found in
// .py, .ipynb, requirements*.txt, package.json and .html files.
//
//   node scripts/stack-card.mjs [output.svg]
//
// Env: GITHUB_USER (default josh1221wa), GITHUB_TOKEN (optional; avoids the
// 60 requests/hour unauthenticated limit).

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const USER = process.env.GITHUB_USER || "josh1221wa";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.argv[2] || "dist/stack.svg";
const MAX_FILES_PER_REPO = 80;
const MAX_FILE_BYTES = 5_000_000;
// A language counts for a repo once it's at least this share of the repo's bytes.
// Ranking by repo count rather than raw bytes, since notebook outputs inflate Jupyter.
const MIN_REPO_SHARE = 0.1;

// GitHub linguist language -> skillicons id
const LANGUAGE_ICONS = {
  Python: "py", "Jupyter Notebook": "py", JavaScript: "js", TypeScript: "ts",
  HTML: "html", CSS: "css", SCSS: "sass", C: "c", "C++": "cpp", "C#": "cs",
  Java: "java", Kotlin: "kotlin", Go: "go", Rust: "rust", R: "r", MATLAB: "matlab",
  Shell: "bash", PowerShell: "powershell", TeX: "latex", Dart: "dart", PHP: "php",
  Swift: "swift", Lua: "lua", Julia: "julia",
};

// Python top-level module -> skillicons id
const PY_MODULE_ICONS = {
  tensorflow: "tensorflow", keras: "tensorflow", torch: "pytorch", torchvision: "pytorch",
  sklearn: "sklearn", selenium: "selenium", pymongo: "mongodb", flask: "flask",
  django: "django", fastapi: "fastapi", cv2: "opencv", sqlite3: "sqlite",
  psycopg2: "postgres", mysql: "mysql", redis: "redis", firebase_admin: "firebase",
  PyQt5: "qt", PyQt6: "qt", PySide6: "qt", boto3: "aws", tweepy: "twitter",
};
// pip package names that differ from their import name
const PIP_ALIASES = { "scikit-learn": "sklearn", "opencv-python": "cv2", "mysql-connector-python": "mysql", "psycopg2-binary": "psycopg2" };

// npm dependency -> skillicons id
const NPM_ICONS = {
  react: "react", next: "nextjs", vue: "vue", svelte: "svelte", express: "express",
  tailwindcss: "tailwind", three: "threejs", d3: "d3", electron: "electron",
  jquery: "jquery", bootstrap: "bootstrap", firebase: "firebase", mongodb: "mongodb", mongoose: "mongodb",
};
// <script>/<link> URLs in HTML
const HTML_PATTERNS = { jquery: /jquery/i, bootstrap: /bootstrap/i, tailwind: /tailwindcss/i, threejs: /three(\.min)?\.js/i };

// Files whose mere presence means a tool is in use
const FILE_MARKERS = [
  [/(^|\/)Dockerfile$/, "docker"],
  [/(^|\/)(firebase\.json|\.firebaserc)$/, "firebase"],
  [/^\.github\/workflows\/.+\.ya?ml$/, "githubactions"],
];

const SCANNED = /\.(py|ipynb|html?)$|(^|\/)(requirements[^/]*\.txt|package\.json)$/i;
const SKIP_DIRS = /(^|\/)(node_modules|venv|\.venv|env|site-packages|dist|build|vendor)\//;

const headers = { "User-Agent": `${USER}-profile-card`, Accept: "application/vnd.github+json" };
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${path} responded ${res.status}: ${await res.text()}`);
  return res.json();
}

async function raw(repo, branch, path) {
  const url = `https://raw.githubusercontent.com/${USER}/${repo}/${branch}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
  return res.ok ? res.text() : "";
}

function pythonImports(code) {
  const mods = new Set();
  for (const m of code.matchAll(/^\s*(?:from\s+([A-Za-z_]\w*)[\w.]*\s+import|import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*))/gm)) {
    if (m[1]) mods.add(m[1]);
    else for (const part of m[2].split(",")) mods.add(part.trim().split(".")[0]);
  }
  return mods;
}

function notebookCode(text) {
  try {
    const nb = JSON.parse(text);
    return (nb.cells || [])
      .filter((c) => c.cell_type === "code")
      .map((c) => (Array.isArray(c.source) ? c.source.join("") : c.source || ""))
      .join("\n");
  } catch {
    return "";
  }
}

async function scanRepo(repo) {
  const found = new Set();
  const tree = await gh(`/repos/${USER}/${repo.name}/git/trees/${repo.default_branch}?recursive=1`).catch(() => ({ tree: [] }));
  const blobs = tree.tree.filter((t) => t.type === "blob" && !SKIP_DIRS.test(t.path));

  for (const b of blobs) for (const [re, icon] of FILE_MARKERS) if (re.test(b.path)) found.add(icon);

  const files = blobs.filter((b) => SCANNED.test(b.path) && b.size <= MAX_FILE_BYTES).slice(0, MAX_FILES_PER_REPO);
  for (const f of files) {
    const text = await raw(repo.name, repo.default_branch, f.path);
    const name = f.path.split("/").pop().toLowerCase();
    if (name.endsWith(".py") || name.endsWith(".ipynb")) {
      const code = name.endsWith(".ipynb") ? notebookCode(text) : text;
      for (const mod of pythonImports(code)) if (PY_MODULE_ICONS[mod]) found.add(PY_MODULE_ICONS[mod]);
    } else if (name.startsWith("requirements")) {
      for (const line of text.split(/\r?\n/)) {
        const pkg = line.trim().split(/[<>=!~\[;\s]/)[0];
        const mod = PIP_ALIASES[pkg.toLowerCase()] || pkg;
        if (PY_MODULE_ICONS[mod]) found.add(PY_MODULE_ICONS[mod]);
      }
    } else if (name === "package.json") {
      try {
        const pkg = JSON.parse(text);
        for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) if (NPM_ICONS[dep]) found.add(NPM_ICONS[dep]);
      } catch {}
    } else {
      for (const src of text.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi))
        for (const [icon, re] of Object.entries(HTML_PATTERNS)) if (re.test(src[1])) found.add(icon);
    }
  }
  return found;
}

const repos = (await gh(`/users/${USER}/repos?per_page=100&type=owner`)).filter((r) => !r.fork && r.name !== USER && r.size > 0);

const languageRepos = {}; // icon -> repo names
const languageBytes = {}; // icon -> bytes, tiebreaker only
const toolRepos = {}; // icon -> repo names
for (const repo of repos) {
  const langs = await gh(`/repos/${USER}/${repo.name}/languages`);
  const repoBytes = Object.values(langs).reduce((a, b) => a + b, 0);
  const counted = new Set();
  for (const [lang, bytes] of Object.entries(langs)) {
    const icon = LANGUAGE_ICONS[lang];
    if (!icon || bytes / repoBytes < MIN_REPO_SHARE) continue;
    languageBytes[icon] = (languageBytes[icon] || 0) + bytes;
    if (!counted.has(icon)) (languageRepos[icon] ||= []).push(repo.name);
    counted.add(icon);
  }
  for (const icon of await scanRepo(repo)) (toolRepos[icon] ||= []).push(repo.name);
}

// Languages first, then tools, each ranked by how many repos use them.
const languages = Object.entries(languageRepos)
  .sort((a, b) => b[1].length - a[1].length || languageBytes[b[0]] - languageBytes[a[0]])
  .map(([icon]) => icon);
const tools = Object.entries(toolRepos)
  .filter(([icon]) => !languages.includes(icon))
  .sort((a, b) => b[1].length - a[1].length)
  .map(([icon]) => icon);
const icons = [...languages, ...tools, "git"];

const res = await fetch(`https://skillicons.dev/icons?i=${icons.join(",")}&theme=dark&perline=${Math.min(icons.length, 16)}`);
if (!res.ok) throw new Error(`skillicons responded ${res.status}`);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, await res.text());
await writeFile(
  join(dirname(OUT), "stack.json"),
  JSON.stringify({ generated: new Date().toISOString(), icons, languageRepos, toolRepos }, null, 2),
);
console.log(`Wrote ${OUT}: ${icons.join(", ")}`);
for (const [icon, names] of Object.entries({ ...languageRepos, ...toolRepos })) console.log(`  ${icon}: ${names.join(", ")}`);
