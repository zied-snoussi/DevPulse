const fs = require('node:fs');

// Figures out what kind of server is behind a listening port,
// from the process name, its command line and the port number.

const RULES = [
  // [test on "name | cmdline" lowercased, label, kind, color]
  [/@angular[\\/]cli|\bng(\.js|\.cmd)?"? serve|\bng serve/, 'Angular', 'dev', '#dd0031'],
  [/[\\/]next[\\/]|next(\.cmd)?"? (dev|start)|next-server/, 'Next.js', 'dev', '#e5e7eb'],
  [/nuxt/, 'Nuxt', 'dev', '#00dc82'],
  [/[\\/]vite[\\/]|\bvite(\.cmd|\.js)?\b/, 'Vite', 'dev', '#a78bfa'],
  [/react-scripts/, 'React (CRA)', 'dev', '#61dafb'],
  [/storybook/, 'Storybook', 'dev', '#ff4785'],
  [/@nestjs|nest(\.js)?"? start/, 'NestJS', 'dev', '#e0234e'],
  [/@remix-run|remix (dev|serve)/, 'Remix', 'dev', '#e5e7eb'],
  [/astro/, 'Astro', 'dev', '#ff5d01'],
  [/svelte-kit|sveltekit/, 'SvelteKit', 'dev', '#ff3e00'],
  [/gatsby/, 'Gatsby', 'dev', '#a371f7'],
  [/webpack(-dev-server| serve)/, 'Webpack', 'dev', '#8ed6fb'],
  [/expo|metro|react-native/, 'React Native', 'dev', '#61dafb'],
  [/firebase|emulators/, 'Firebase', 'dev', '#ffca28'],
  [/json-server/, 'JSON Server', 'dev', '#fbbf24'],
  [/live-server|http-server|serve(\.js)?"? -|browser-sync/, 'Static server', 'dev', '#94a3b8'],
  [/nodemon/, 'Nodemon', 'dev', '#76d04b'],
  [/ts-node|tsx(\.cmd)?"? /, 'Node (TS)', 'dev', '#3178c6'],
  [/manage\.py"? runserver|django/, 'Django', 'dev', '#44b78b'],
  [/uvicorn|fastapi/, 'FastAPI', 'dev', '#05998b'],
  [/flask/, 'Flask', 'dev', '#e5e7eb'],
  [/gunicorn/, 'Gunicorn', 'dev', '#499848'],
  [/jupyter/, 'Jupyter', 'dev', '#f37626'],
  [/artisan"? serve|laravel/, 'Laravel', 'dev', '#ff2d20'],
  [/spring|bootrun|\.jar\b.*boot/, 'Spring Boot', 'dev', '#6db33f'],
  [/tomcat|catalina/, 'Tomcat', 'dev', '#f8dc75'],
  [/gradle/, 'Gradle', 'dev', '#02303a'],
  [/rails|puma/, 'Rails', 'dev', '#cc0000'],
  [/flutter|dart(\.exe)?/, 'Flutter / Dart', 'dev', '#02569b'],
  [/iisexpress/, 'IIS Express', 'dev', '#512bd4'],
  [/dotnet|\.dll\b/, '.NET', 'dev', '#512bd4'],
  [/^postgres/, 'PostgreSQL', 'db', '#336791'],
  [/^mysqld|^mariadbd/, 'MySQL', 'db', '#f29111'],
  [/^mongod\b/, 'MongoDB', 'db', '#47a248'],
  [/^redis-server|^memurai/, 'Redis', 'db', '#dc382d'],
  [/^sqlservr/, 'SQL Server', 'db', '#cc2927'],
  [/^oracle|^tnslsnr/, 'Oracle DB', 'db', '#f80000'],
  [/^elasticsearch|elasticsearch/, 'Elasticsearch', 'db', '#fec514'],
  [/^rabbitmq|erl\.exe.*rabbit|^epmd/, 'RabbitMQ', 'db', '#ff6600'],
  [/^com\.docker|^docker|^vpnkit|^wslrelay/, 'Docker', 'infra', '#2496ed'],
  [/^wsl|^vmmem/, 'WSL', 'infra', '#f59e0b'],
  [/^nginx/, 'Nginx', 'infra', '#009639'],
  [/^httpd/, 'Apache', 'infra', '#d22128'],
  [/^ollama/, 'Ollama', 'infra', '#e5e7eb'],
  [/^node\b/, 'Node.js', 'dev', '#5fa04e'],
  [/^bun\b/, 'Bun', 'dev', '#fbf0df'],
  [/^deno\b/, 'Deno', 'dev', '#70ffaf'],
  [/^python|^py\b/, 'Python', 'dev', '#3776ab'],
  [/^java|^javaw/, 'Java', 'dev', '#f89820'],
  [/^php/, 'PHP', 'dev', '#777bb4'],
  [/^ruby/, 'Ruby', 'dev', '#cc342d'],
  [/^go\b|__debug_bin/, 'Go', 'dev', '#00add8'],
  [/^code\b|^cursor\b|^windsurf/, 'Editor', 'app', '#3b82f6'],
  [/^chrome|^msedge|^firefox|^brave|^opera/, 'Browser', 'app', '#f59e0b'],
  [/^adb\b/, 'Android ADB', 'dev', '#3ddc84'],
  [/^studio64|^android/, 'Android Studio', 'dev', '#3ddc84'],
  [/^postman/, 'Postman', 'app', '#ff6c37'],
  [/^system$/, 'Windows (HTTP.sys)', 'system', '#64748b'],
  [/^svchost/, 'Windows service', 'system', '#64748b'],
  [/^(lsass|wininit|services|spoolsv|searchhost|searchindexer|msmpeng|nissrv)$/, 'Windows', 'system', '#64748b'],
];

const WELL_KNOWN = {
  135: 'RPC', 139: 'NetBIOS', 445: 'SMB', 5040: 'Windows', 5357: 'WSD', 7680: 'Delivery Optimization',
  3389: 'Remote Desktop', 5432: 'PostgreSQL', 3306: 'MySQL', 27017: 'MongoDB', 6379: 'Redis',
  1433: 'SQL Server', 9200: 'Elasticsearch', 5672: 'RabbitMQ', 11434: 'Ollama', 9229: 'Node inspector',
};

/** Ports that are almost always something a developer launched. */
const DEV_PORT_HINT = (port) =>
  (port >= 3000 && port <= 3999) || (port >= 4000 && port <= 4999) || (port >= 5000 && port <= 5999) ||
  (port >= 8000 && port <= 8999) || port === 9000 || port === 9229 || port === 19000 || port === 19006 || port === 6006;

function detect({ name = '', cmd = '', port = 0, service = '' }) {
  const n = String(name).toLowerCase();
  const hay = `${n} | ${String(cmd).toLowerCase()}`;
  if (n === 'system' && WELL_KNOWN[port]) return { label: WELL_KNOWN[port], kind: 'system', color: '#64748b' };
  for (const [re, label, kind, color] of RULES) {
    // Rules anchored with ^ test the process name; others test the full haystack.
    const target = re.source.startsWith('^') ? n : hay;
    if (re.test(target)) {
      if (kind === 'system' && service) return { label: service, kind, color };
      return { label, kind, color };
    }
  }
  if (WELL_KNOWN[port]) return { label: WELL_KNOWN[port], kind: 'system', color: '#64748b' };
  return { label: name || 'Unknown', kind: DEV_PORT_HINT(port) ? 'dev' : 'app', color: '#94a3b8' };
}

/** Extract a project folder from a command line, e.g. C:\PROJECTS\app\node_modules\vite\... -> C:\PROJECTS\app */
function projectFromCmd(cmd = '') {
  const dir = rawProjectFromCmd(cmd);
  if (!dir || /\\(program files|windows|programdata)/i.test(dir) || !fs.existsSync(dir)) return null;
  return dir;
}

function rawProjectFromCmd(cmd) {
  if (!cmd) return null;
  const m = cmd.match(/([A-Za-z]:\\[^"*?<>|]*?)\\node_modules\\/i);
  if (m) return m[1];
  const py = cmd.match(/([A-Za-z]:\\[^"*?<>|]*?)\\(?:\.venv|venv|env)\\/i);
  if (py) return py[1];
  const script = cmd.match(/([A-Za-z]:\\[^"*?<>|]*?)\\[^\\"]+\.(?:py|js|mjs|cjs|ts|jar|php|rb|dll)\b/i);
  if (script && !/\\(program files|windows|appdata\\local\\programs)/i.test(script[1])) return script[1];
  return null;
}

const CRITICAL = new Set([
  'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso',
  'fontdrvhost', 'dwm', 'memory compression', 'secure system', 'svchost', 'msmpeng', 'sgrmbroker',
]);

const WINDIR = `${(process.env.SystemRoot || 'C:\\Windows').toLowerCase()}\\`;

/** Protected Windows process. A "system" name running from outside C:\Windows is an impostor, not protected. */
function isCritical(pid, name = '', exePath = null) {
  if (pid <= 4) return true;
  if (!CRITICAL.has(String(name).toLowerCase().replace(/\.exe$/, ''))) return false;
  return !exePath || String(exePath).toLowerCase().startsWith(WINDIR);
}

module.exports = { detect, projectFromCmd, isCritical, DEV_PORT_HINT };
