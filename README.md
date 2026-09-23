# DevPulse

A Windows desktop companion for developers: see which ports are in use and which server owns each one, kill a port in one click, and watch your PC's performance live.

## Features

- **Ports**: every listening TCP/UDP port with its process, PID, detected framework (Angular, Vite, Next.js, NestJS, Django, Spring Boot, PostgreSQL, Docker…), project folder, address, connections, memory and uptime.
  - **Free a port**: type `3000` and press Enter.
  - Kill one server, kill its whole process tree, or stop all dev servers at once.
  - Open `http://localhost:<port>`, copy the command line, open the project folder.
- **Dashboard**: live CPU (per core and clock speed), memory, GPU, disk activity, network, storage, battery, the top CPU and RAM consumers, running dev servers, and health insights.
- **Processes**: grouped by app (e.g. Chrome × 19), sortable by CPU, RAM or GPU, with End task for a single process or the whole group.
- **Security**: a heuristic threat scanner (not a replacement for antivirus) that flags processes and startup programs that behave like malware, and explains why:
  - a Windows process name (svchost, lsass…) running from the wrong folder, or a lookalike name like `scvhost.exe`
  - unsigned or tampered files outside Program Files and Windows, or running from Temp, Downloads or the Recycle Bin
  - hidden encoded PowerShell, download-and-run commands, Office apps spawning shells, shadow-copy deletion, crypto-miner patterns
  - unsigned programs talking to the internet or to mining-pool ports

  Each finding offers Kill, Show file, **Scan with Windows Defender**, **Check on VirusTotal** (by SHA-256 hash only, no upload) and "I trust this". The page also shows a security score and your Defender status, and can run a Defender quick scan.
- **Optimize**: Gaming, Development and Battery saver profiles. Each one lists the recommended changes (power mode, Game Mode, background game recording, mouse acceleration, GPU scheduling, long paths, Developer Mode, Git long paths, transparency, animations, background apps) with Apply and Revert buttons.
  - Your original values are saved before the first change, so "Restore all" undoes everything.
  - Changes that need admin rights share one UAC prompt.
  - It suggests apps to close for each profile, and has quick fixes: clean temp files, shut down WSL, open startup apps.
- **Command palette** (`Ctrl+K`): type a port number or an app name to kill it.
- **Tray icon**: right-click to see running dev servers and kill them without opening the window.
- **Safety**: kills are confirmed, critical Windows processes are protected, and there's a one-click restart as administrator.
- Dark and light themes, adjustable refresh rate, always-on-top option.

## Run

```bash
npm install
npm run dev      # hot-reload development
npm start        # production build + run
npm run dist     # build a Windows installer + portable exe into release/
```

Shortcuts: `Ctrl+1…5` switch pages, `Ctrl+F` search, `Ctrl+,` settings.

## How it works

Electron main process (`electron/`) collects data with Node's `os` module, `netstat -ano`, and a persistent PowerShell session that queries raw Windows performance counters, which is fast (~20 ms per query). Processes are killed with `taskkill /T /F`. The UI is React + TypeScript + Vite (`src/`), with hand-built SVG charts and no UI framework.
