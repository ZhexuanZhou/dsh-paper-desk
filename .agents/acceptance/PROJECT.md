# PROJECT.md — acceptance adapter for DSH PaperDesk

## 1. Project summary

PaperDesk is a DSH plugin for importing and reading papers, managing notes, and asking an AI assistant about papers. The repository is the plugin package. Its `package.json` declares a web client injected into the DSH host. The acceptance target is the real PaperDesk panel inside the macOS DeepSeek Harness app, not a standalone mock.

## 2. Environment

- **Start / stop for acceptance:** Use an isolated DSH profile and `DSH_HOME` at `.acceptances/standalone-paperdesk-redesign/<round>/dsh-home`; profile name `paperdesk-acceptance`. Do not use the `dsh` shell wrapper for startup: it can hand off to the running Electron Desktop Host singleton. Use the verified direct-core launcher `.acceptances/release-1.0-validation/start-isolated-core.cjs` with `ELECTRON_RUN_AS_NODE=1` and the installed Harness executable. The launcher imports the installed `@deepseek-ai/dsh/lib/bin.js` `runCli` entry, validates that `DSH_HOME` is inside `.acceptances`, and sets `process.argv` to `--profile paperdesk-acceptance --no-open --host 127.0.0.1 --port 0`. Keep the generated auth URL in a mode-600 private file and never include the token in reports or screenshots. Verify the listener PID/command and active profile on every run. Stop only the direct `runCli` session owned by that run. Do not restart, kill, or mutate the user's `desktop` profile.
- **Plugin mapping:** The accepted profile bundle list is `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and `dsh-paper-desk`. The verified profile `package.json` shape is a dependency `dsh-paper-desk: link:../../../../../..` plus that bundle list; the relative link reflects the accepted round’s `dsh-home` directory depth. Verify `realpath "$PROFILE/node_modules/dsh-paper-desk"` before launch. Do not use `dsh plugin` wrapper commands to change the mapping. If a mapping must change, stop the owned Web process, update only the isolated profile package dependency with its profile-local package manager, then verify the link target and bundle list before restarting. Keep the package manager store inside the isolated DSH_HOME.
- **Required services:** No separate service startup is confirmed. The DSH web server binds loopback and prints its browser URL when started.
- **Already-running detection:** Use `lsof` for the selected loopback port and inspect the isolated profile's DSH page/version before reuse. Recheck versions, ports, paper counts and window identity for each run; those values change over time.
- **Model auth:** Use the isolated profile's configured provider authentication for real model calls. Never print, attach or commit credentials. Do not copy sessions or the real desktop profile into the isolated profile.

## 3. Auth

- **Test account(s):** Isolated DSH profile reuses the user's configured provider credentials for real model calls; credentials are copied locally with restricted permissions.
- **Seeding command:** None.
- **Per-surface status check:** Load the local DSH web page and confirm the isolated PaperDesk panel loads the fixture library. Do not include credentials in evidence.

## 4. Surfaces

### Web

- **Launch:** Isolated direct `runCli` web process; see §2. It serves the real DSH host and the locally linked PaperDesk plugin without asking the desktop wrapper to take over the native singleton.
- **Base URL:** Loopback URL printed by the new run; port `0` asks the OS to choose a free port.
- **Browser session:** Use the provided CUA browser with the local DSH URL from the run's private `server-url.txt`. Keep the one-time auth URL/token out of reports, screenshots, and tracked files. Verify the current browser tab points to the owned loopback port before reading or capturing content.
- **Evidence:** Capture the product UI with the browser session or native window only. Confirm the target tab/window and visible PaperDesk content before saving a native capture. Open each evidence PNG with an image-capable inspector before citing it.

## 5. Project probes & quick navigation

- **App-state probe:** Computer Use accessibility state or browser snapshot on the isolated DSH page.
- **Quick navigation:** Open the PaperDesk plugin panel in the DSH web UI. Its header shows the loaded package version.
- **Isolation proof:** Confirm the active library path is the run's `.acceptances/.../fixtures/library`, and confirm fixture paper IDs/count from `fixture-manifest.json` before any write.
- **Baseline state:** Treat any pre-change screenshot as comparison-only; never write to the user's library.

## 6. Known constraints

- The user's real library and existing conversations are present in the running desktop profile. All acceptance write cases must use the isolated profile and fixture library; do not modify real papers, notes, conversations, or subscription state.
- The desktop profile is managed exclusively by the Electron application. Do not mutate it with `dsh plugin` commands.
- The current baseline screenshot is a native window capture from the pre-change v0.3.49 DSH window. Its metadata and hash are in `.acceptances/standalone-paperdesk-redesign/20261112-030500-pre-change/source-index.md`.
- Do not use mock AI output as proof of real model or multimodal behavior. Record the actual model/provider identity and request evidence for claims about model calls.
