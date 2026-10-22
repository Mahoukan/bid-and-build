# Build Bid & Build in Visual Studio Code

Prepared 22 October 2026 for Windows + VS Code, with GitHub and Coolify hosting.

This folder contains the complete specification and staged Codex instructions. It does not contain the implemented game yet. Codex will create the application here. There is no package.json until Milestone 1, so do not run npm install before that stage creates it.

**1. Install the tools once**

| Tool | What to do |
| --- | --- |
| Visual Studio Code | Use your existing installation, or install from https://code.visualstudio.com/ |
| Node.js | Install the current Node 24 LTS patch from https://nodejs.org/en/download; include npm |
| Git | Install Git for Windows from https://git-scm.com/install/windows |
| Codex extension | Open the official guide at https://developers.openai.com/codex/ide and use its installation link for VS Code; sign in when prompted |
| GitHub | Use your existing account when publishing the repository |
| Docker | Optional on your computer until the final container test; Coolify will build the Docker image on your server |

Node 24 is the LTS baseline checked for this pack. Use the same major version in development, CI and Docker. If you already use WSL for Codex, stay within that environment consistently; the command examples below assume Windows PowerShell. In WSL/macOS/Linux, use npm/npx instead of npm.cmd/npx.cmd.

Restart VS Code after installing Node or Git. Open Terminal > New Terminal and check:

```powershell
node --version
npm.cmd --version
git --version
```

Node should report v24.x.x; npm and Git should report version numbers. If a command is not recognised, fix that installation/PATH first rather than asking Codex to work without it. PowerShell examples use npm.cmd to avoid npm.ps1 execution-policy errors without changing your security settings.

**2. Extract and open the project folder**

1. Extract the downloaded ZIP.
2. Move its inner `bid-and-build` folder somewhere convenient, for example `C:\Projects\bid-and-build`. Use a fresh folder rather than another app's repository.
3. In VS Code, choose File > Open Folder and open that folder. AGENTS.md, CODEX_PROMPTS.md and START-HERE.md should be at the top level in Explorer.
4. Trust the folder if you are satisfied these are the files you intend to work on.
5. Open START-HERE.md and press Ctrl+Shift+V for a readable Markdown preview.

Do not open just one file, run from inside the ZIP or accidentally open the parent folder containing multiple projects. The folder you open becomes the project/repository root.

**3. Make an initial Git checkpoint**

In VS Code's terminal, with that project folder as the current directory:

```powershell
git init -b main
git status
```

If you already have an intentionally created repository here, skip git init and inspect git status instead. Before committing, configure your Git author identity if it is not already set. Replace the example values; a GitHub no-reply address is fine:

```powershell
git config user.name "YOUR NAME"
git config user.email "YOUR GIT COMMIT EMAIL"
```

These two settings apply to this repository. Now save the instruction pack as the first checkpoint:

```powershell
git add .
git commit -m "Add Bid and Build specification and Codex plan"
```

The supplied .gitignore keeps future environment files, databases, uploads and dependency folders out of Git. Review staged files before each later commit.

**4. Start Codex**

Open the Codex sidebar in VS Code. If it is missing, use Ctrl+Shift+P and search for `Codex: Open Codex Sidebar`. Sign in and follow the extension's setup prompts. Select local work in this project, an available coding model, and **High** reasoning. Use a mode that can edit files and run project commands, rather than a planning-only conversation. Keep the normal permission protections; approve legitimate setup/dependency operations as needed.

Open FIRST-PROMPT.txt, copy its entire contents and paste it into Codex. It tells Codex to read the supplied files and implement **Milestone 1 only**. You do not need to paste the full brief or all nine milestones into the chat.

The pack's files have distinct purposes:

| File | Purpose |
| --- | --- |
| FIRST-PROMPT.txt | The first message to paste |
| AGENTS.md | Persistent project rules for Codex |
| PROJECT_BRIEF.md | Full agreed product behaviour |
| CODEX_PROMPTS.md | Nine implementation stages plus continuation/fix prompts |
| PROGRESS.md | Current stage, verified work and remaining checks |
| ACCEPTANCE-CHECKLIST.md | Manual checks before hosting |
| docs/COOLIFY-SETUP.md | GitHub/Coolify deployment and storage steps |
| samples/dragon-game.json | Importable example once the builder exists |

**5. Review one milestone at a time**

After each milestone:

1. Read Codex's summary and check whether any commands or tests could not run.
2. Run the relevant manual check written below that milestone in CODEX_PROMPTS.md.
3. If it fails, send the steps and error text using the fix prompt at the bottom of that file. Finish the current stage before moving on.
4. When satisfied, inspect Source Control changes and commit them. A suggested commit message is supplied for each stage.
5. Ask Codex to implement the next milestone. You can paste the continuation prompt, or say: `Implement Milestone 2 from CODEX_PROMPTS.md. Follow AGENTS.md, verify it and update PROGRESS.md.` Change the number as you progress.

If you open a new Codex chat, use the continuation prompt so it reads PROGRESS.md and the current files. Keep the documents in the repository. Check the progress file if Codex's summary and the app disagree; completed means implemented and verified, not merely attempted.

After app files exist, this is the intended normal development loop:

```powershell
npm.cmd run dev
```

Open the frontend URL printed by the terminal, intended to be http://localhost:5173. Leave that terminal running. Open a second terminal for checks:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

Stop the dev processes with Ctrl+C in their terminal. Codex should keep these commands cross-platform and document any deliberate change. `npm ci` is for a clean install from an existing lockfile; ordinary source edits do not require reinstalling packages. The dev startup/setup should create .env if missing without overwriting your existing settings or printing secrets.

Milestone 5 adds Playwright. If the browser binary is not installed, use:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

These commands are only available once Codex creates their scripts/dependencies. Test output must distinguish passing checks from checks skipped because a tool was unavailable.

**6. Test multiple players on one computer**

Use independent browser profiles or different browsers. For example, host in your normal Chrome profile, join as another player in an Edge profile and a third in a separate Chrome profile. Use up to five profiles/contexts for the capacity check. Multiple tabs in one profile share local storage and should reconnect/take over the same seat, not create independent identities. Multiple private windows in the same browser may also share a private session.

In browser developer tools, test the portrait sizes 360×640 and 390×844, and landscape sizes 1280×720 and 1440×900. Check that the game page stays within the viewport and controls remain reachable. Then test a real phone: developer-tool emulation does not reproduce every mobile keyboard or browser-bar behaviour.

**7. Test on real phones before deployment**

After multiplayer exists:

1. Connect the computer and phones to the same trusted network. Keep the app local; do not configure router port forwarding.
2. Run `ipconfig` in PowerShell and find the computer's active IPv4 address, for example 192.168.1.50. Use your actual address.
3. Stop the dev server. In the ignored .env, set APP_ORIGIN to `http://192.168.1.50:5173` using your address, and keep HOST=0.0.0.0. Restart `npm.cmd run dev`.
4. Use that same LAN URL on the host computer and phones. Do not give phones a localhost URL; localhost means the phone itself. Room join links should use the configured reachable origin.
5. If Windows asks about Node network access, permit it only for the trusted private network. If you are on a managed/school network that isolates devices, use an approved staging deployment instead of altering those controls.

Changing the origin from localhost to a LAN address creates a different browser-storage area. A missing local draft/theme at the new address is expected: export/import the draft. Keep a private recovery code to recover a seat from another browser/origin. The final HTTPS domain will have its own local storage too.

**8. Create your administrator after Milestone 7**

The requested implementation supplies these interactive commands. Use your terminal rather than putting your real password into a Codex message:

```powershell
npm.cmd run build
npm.cmd run admin:create
```

Enter your chosen administrator credentials when prompted, then visit /admin. If you later forget the password, use `npm.cmd run admin:reset-password`. The commands must target the same DATA_DIR as the app. Production has a separate database, so create the production admin there as described in the deployment guide. Do not copy your development database into the image.

**9. Publish and deploy after the final checks**

Finish ACCEPTANCE-CHECKLIST.md and review PROGRESS.md. In VS Code Source Control, commit the app and choose Publish to GitHub. Select a private repository initially, name it `bid-and-build`, and complete GitHub sign-in. Basic publishing does not require a separate GitHub extension. If you already have a remote repository, push to that intended remote instead of creating a duplicate.

Then follow docs/COOLIFY-SETUP.md. Coolify needs access to the private repository through its GitHub integration or a deploy key; you do not need to make it public. Keep manual deployments initially so a routine code push cannot interrupt an active game.

**10. Common problems**

| Problem | Next step |
| --- | --- |
| `package.json` missing | Complete Milestone 1 and ensure the terminal is in the project root |
| `npm.ps1` blocked | Use `npm.cmd` and `npx.cmd` as shown; do not change system-wide execution policy |
| Node/Git not recognised | Reopen VS Code after installation and recheck PATH |
| Port already in use | Stop the earlier dev process with Ctrl+C; ask Codex to identify the listener if unsure |
| A second tab becomes the same player | Use a separate browser profile for an independent player |
| Phone cannot connect | Check the LAN address, HOST binding, APP_ORIGIN, private-network firewall permission and network isolation |
| Native SQLite package fails to install | Give Codex the error; verify its chosen driver supports Node 24 and Windows. Install only the documented build tools if genuinely required |
| Layout test passes but a button is missing | Report it as a bug; overflow measurements alone are insufficient |
| Files disappeared after a container update | Check the DATA_DIR mount; use your backups before making storage changes |

Official references and the date checked are listed in docs/SOURCES.md. This pack's verification covers its instructions and contents; application tests begin when Codex implements the app.
