# Installing AgentEd in restricted and offline networks

This page is for teams that bring software into a closed network after a security review: what AgentEd needs, where to get it, in what order to install it, what the installer writes, and what stays after. It describes **AgentEd 1.0.0** (`v1.0.0`, commit `881ea3a`).

**How to read it.** Every statement about behaviour names where it was measured. The Windows measurements were made on 2026-11-04 in a VirtualBox 7.2.20 virtual machine running **Windows 10 Enterprise LTSC 10.0.19044**, installed with no network, as a user who is a local administrator, with the **WebView2 Runtime 156.0.4314.58**. The full records, with the scripts used, are on [issue #693](https://github.com/cgxopen/AgentEd/issues/693). Where something was read in source code rather than measured, or not measured at all, this page says so.

## 1. What AgentEd does on the network

**AgentEd makes no network calls of its own**: no telemetry, no update check, no account, nothing sent anywhere. Every feature works with the machine offline ([REQUIREMENTS.md](../REQUIREMENTS.md), Q3). In the Windows measurements, `agented.exe` opened no outbound connection in any run.

AgentEd draws its window with the web runtime the operating system provides, and that runtime has behaviour of its own, which AgentEd cannot turn off.

### Windows: WebView2

The runtime runs as `msedgewebview2.exe` processes started by AgentEd; Task Manager shows AgentEd as `agented.exe` and six **Microsoft Edge WebView2** processes. Measured with the Windows Filtering Platform audit (Security event 5156), one launch left untouched for 75 seconds:

| network the machine has | what `msedgewebview2.exe` opened |
| --- | --- |
| **No network adapter** | **Nothing**: no outbound attempt, allowed or blocked, over three launches |
| **An internal DNS resolver** | **UDP 53 to that resolver**, its own queries; **TCP 443** to Microsoft addresses; once **UDP 443** to a Microsoft address |
| **A public DNS resolver** (here Google Public DNS, `8.8.8.8`) | **UDP 53 to that resolver**; **TCP 443 to the same provider** (`8.8.4.4` and its IPv6 address); **TCP 443** to Microsoft addresses |

What a firewall team should know:

- **The runtime sends its own DNS queries** to the resolver the system was given, rather than through the DNS client of Windows. Names blocked in the Windows DNS cache or by its client settings do not describe what the runtime resolves.
- **With a public resolver it also opens HTTPS to that DNS provider.** READING, not measured: the runtime upgrades to DNS over HTTPS when the system resolver is a provider it knows. With an internal resolver it reached no public DNS provider.
- **The runtime reaches two names: `config.edge.skype.com` and `edge.microsoft.com`, on TCP 443.** Found in a capture of its DNS queries, one launch on an internal resolver: its TCP 443 connections went to answers of exactly those two names, and to nothing else. **Their addresses change from launch to launch** (for example `150.171.22.17`, `150.171.27.11`, `150.171.28.11`, `52.123.244.15`, and several IPv6 addresses in `2620:1ec::` and `2603:1063::`), behind Microsoft traffic-manager names, and one launch also sent UDP 443 to such an address. **Write rules by name, or by process, protocol and port: TCP and UDP 443 from `msedgewebview2.exe`**; not by a list of addresses.
- **The runtime reads the Windows hosts file.** With both names pointed at an address that never answers, it asked neither of them on the wire and tried that address instead.
- **Names Windows itself asks are not AgentEd.** In the same captures, `v10.events.data.microsoft.com` and `ctldl.windowsupdate.com` were asked by `svchost.exe`, joined to the process by source port; `msedge.b.tlu.dl.delivery.mp.microsoft.com` was asked too, by a process not joined, READING Edge Update. `msedgewebview2.exe` connected to none of their answers.
- **The runtime does not reach its names at every launch.** READING, from one launch of each case: a launch some minutes after another that had reached the names made no attempt at all, and a launch right after one that could not reach them tried again. It appears to try until it succeeds, then not for a while; how long was not measured.
- **The runtime also looks up the host name of a link** in the open document when the pointer enters it, and connects at mousedown, before any click (Q3, measured on an earlier build).
- **AgentEd opens in about 1 to 2.5 seconds in the virtual machine, online and with no network adapter** (window visible after 1.0 to 2.5 s online and 1.9 s offline). This is a reading of one virtual machine, not a figure for physical hardware.
- **Blocking the two names did not stop the launch, and did not visibly slow it.** With both names sent to an address that never answers, so that the attempts waited unanswered as behind a dropping firewall (a connection there timed out after 21 s), the window was visible after **2.6 s** on the first launch and **1.5 s** on the next, against 1.2 to 2.5 s on an open network. One launch of each: within the spread of the open launches, not a measured absence of delay.

### Linux: WebKitGTK

**It reached nothing**: on WebKitGTK 2.52.6 under Ubuntu 24.04.5, a launch left untouched, the pointer on a link and a mousedown on it made no lookup and no connection (Q3, #550).

### macOS: WKWebView

**It reached nothing at launch** or over a link, on macOS 27.0.1. The web view is a client of the Safe Browsing service of the system, which updates its list from Apple on its own schedule; in the measured runs it checked no address (Q3, #653). Parts of that are readings, and Q3 says which.

## 2. What each platform needs, and how to check it

### Windows: the WebView2 Evergreen Runtime

AgentEd needs the **Microsoft Edge WebView2 Runtime**, which it does not bundle. Windows 11 includes it. Windows 10 may not have it.

**Check whether a machine has it.** The installer of AgentEd looks for the value `pv` in these keys, in this order; a version means the runtime is present:

```
HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}
HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}
```

In PowerShell:

```powershell
(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue).pv
```

**Get it for an offline machine**: the **Evergreen Standalone Installer** from Microsoft, x64 for AgentEd 1.0.0, at <https://developer.microsoft.com/microsoft-edge/webview2/>. It is signed by Microsoft Corporation. Measured: run as `MicrosoftEdgeWebView2RuntimeInstallerX64.exe /silent /install` with no network, it exited with code 0 after 70 seconds and installed **156.0.4314.58**, per machine, under `C:\Program Files (x86)\Microsoft\EdgeWebView`, with Microsoft Edge Update beside it. It was run from an administrator PowerShell; a run as a standard user was not measured.

**Minimum version: not measured.** AgentEd 1.0.0 is built against the WebView2 SDK 1.0.3800.47, which corresponds to runtime 145. READING from the source of the libraries it uses: nothing AgentEd needs to open its window requires a runtime newer than the first WebView2 releases, and Microsoft does not document that an older runtime is refused. Use a current Evergreen runtime; version 156.0.4314.58 is the one measured.

### Linux: the packages the deb declares

Read from the release package with `dpkg-deb -I` (measured on the DEV server):

```
Depends: libc6 (>= 2.34), libwebkit2gtk-4.1-0, libgtk-3-0
```

Place these packages, and what they depend on, in your internal mirror; `apt` then resolves them. The package runs no install scripts of its own: it holds only its files and their checksums. It installs `/usr/bin/agented`, `/usr/lib/AgentEd/THIRD-PARTY-NOTICES.txt`, `/usr/share/applications/AgentEd.desktop` (which declares `text/markdown`) and three icons under `/usr/share/icons/hicolor`.

### macOS: nothing to bring in

The system web view is part of macOS. The build is for Apple Silicon and is not notarized; the [README](../README.md#macos-installation) gives the steps for the first launch.

## 3. The order and the form of installation on Windows

**First, the runtime.** Install the WebView2 Evergreen Runtime as above, then check the registry value.

**Then AgentEd.** What happens if you do not:

- **Without the runtime and without network, the AgentEd installer stops** and installs nothing. Measured: it tries to download the WebView2 bootstrapper from Microsoft, fails with `Error: Downloading WebView2 Failed - resolving hostname`, and shows `Installation Aborted` with **`Failed to install WebView2! The app can't run without it. Try restarting the installer.`** Exit code 2. Nothing of AgentEd is left on disk or in the registry.
- **With the runtime present**, it installs with no network. Measured: exit code 0, and AgentEd opened offline.

**Per user, no administrator rights expected.** The installer installs for the current user into `%LOCALAPPDATA%\AgentEd`. In the measurements, run by a local administrator, no UAC prompt appeared. READING from the installer template: it asks for user-level rights only, so a standard user should see no UAC prompt either; **not measured with a standard user**. A per-machine install is not offered in 1.0.0.

**Silent install for distribution tools: `/S`.** Measured: `AgentEd_1.0.0_x64-setup.exe /S` does not wait for the network. Without the runtime it exited with **code 2 after 2.2 seconds** and installed nothing, so check for the runtime first. With the runtime present, a silent install was not measured; the interactive install succeeded. READING from the template: in silent mode the desktop shortcut is always created, and `/NS` skips shortcuts; `/D=<folder>` chooses the folder.

**What the installer writes**, measured, as a diff of the machine before and after:

| where | what |
| --- | --- |
| `%LOCALAPPDATA%\AgentEd\` | `agented.exe`, `THIRD-PARTY-NOTICES.txt`, `uninstall.exe` |
| `%APPDATA%\Microsoft\Windows\Start Menu\Programs\AgentEd.lnk` | Start menu shortcut |
| `%USERPROFILE%\Desktop\AgentEd.lnk` | desktop shortcut, from a box ticked by default on the last page |
| `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentEd` | the entry in Apps and Features: name, version 1.0.0, publisher `agentedapp`, install location, uninstall command |
| `HKCU\Software\agentedapp\AgentEd` | the install folder, and `Installer Language=1033` |
| `HKCU\Software\Classes\.md` and `HKCU\Software\Classes\md` | the `.md` file association: **AgentEd opens Markdown files for that user** |

The last page also has **Run AgentEd** ticked by default; the first launch creates the settings folder below.

## 4. Checking a download before installing

Each release publishes a `.sha256` file beside every asset and a combined `SHA256SUMS.txt`. Compare the hash of your download with the published line:

- Windows PowerShell: `Get-FileHash AgentEd_1.0.0_x64-setup.exe -Algorithm SHA256`
- macOS: `shasum -a 256 AgentEd_1.0.0_aarch64.dmg`
- Linux: `sha256sum AgentEd_1.0.0_amd64.deb`

Measured for 1.0.0: the Windows installer is 2756410 bytes with SHA-256 `5fe981d3467105134eb02f911da4d52e810eb01305cf8a15be4fef40434a27e2`; the deb is 3537674 bytes with `481a4800fc5d261c5d061345c2b3d00c8339ee2d4152321a37a980cc5c1a40c4`; both equal their lines in `SHA256SUMS.txt`. The checksums are not signed with a published key, and the Windows installer is not digitally signed: a matching checksum shows the file is the one published, not that it is safe.

## 5. What stays after

### Settings, and what AgentEd writes on its own

AgentEd writes your documents only where you save them. Its settings (theme, palette, last folder, recent files, frequent emoji) live in the local storage of the web runtime.

| platform | settings | how known |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\com.agentedapp.editor\EBWebView\` | measured |
| Linux | `~/.local/share/com.agentedapp.editor` and `~/.config/com.agentedapp.editor` | the README |
| macOS | `~/Library/WebKit/com.agentedapp.editor/`, `~/Library/Caches/com.agentedapp.editor/`, and the file `window-background` in `~/Library/Application Support/com.agentedapp.editor/` | READING from the source, not measured |

On Windows nothing is written under `%APPDATA%\com.agentedapp.editor` (measured).

### Uninstalling on Windows

From **Apps and Features**, or `%LOCALAPPDATA%\AgentEd\uninstall.exe`; silent with `/S`. Measured with `/S`: exit code 0; the install folder, both shortcuts, the Apps and Features entry and the `md` file type were removed. **These stayed:**

| left behind | why |
| --- | --- |
| `%LOCALAPPDATA%\com.agentedapp.editor\` | the settings; removed only when **Delete the application data** is ticked, and a silent uninstall never ticks it |
| `HKCU\Software\agentedapp\AgentEd` | the install folder; removed only with that box ticked |
| `HKCU\Software\Classes\.md`, with an empty value | the uninstaller restores the value saved at install, which was empty on a machine with no previous `.md` association |
| `%LOCALAPPDATA%\Temp\~nsu1.tmp\Un.exe` | the copy of the uninstaller that ran from Temp |

An interactive uninstall with the box ticked was not measured; READING from the template, it also removes the first two rows.

**To remove what stays**, as the same user, after uninstalling:

```powershell
Remove-Item "$env:LOCALAPPDATA\com.agentedapp.editor" -Recurse -Force
Remove-Item "HKCU:\Software\agentedapp" -Recurse -Force
# Only if nothing else uses .md: the key left with an empty value
Remove-Item "HKCU:\Software\Classes\.md" -Recurse -Force
Remove-Item "$env:LOCALAPPDATA\Temp\~nsu*.tmp" -Recurse -Force
```

The WebView2 Runtime is a separate product and stays installed; other applications may use it.

### Uninstalling on Linux and macOS

On Linux, `sudo apt remove agent-ed` leaves the two settings folders above (the README). On macOS, AgentEd has no uninstaller: deleting the app leaves the folders above; **not measured**.

## 6. For a reviewer

| what | where |
| --- | --- |
| Third-party notices | `THIRD-PARTY-NOTICES.txt` beside the application (Windows: `%LOCALAPPDATA%\AgentEd\`; Linux: `/usr/lib/AgentEd/`), and **☰ → Help → About AgentEd → Third-party notices** |
| Security policy | [SECURITY.md](../SECURITY.md) |
| Content Security Policy | `app.security.csp` in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json): scripts and styles from the application itself only, images from the application or from data inside the page, and connections only to the internal channel between the page and the application |
| Tauri capabilities, what the page may ask of the system | [src-tauri/capabilities/](../src-tauri/capabilities/) |
| Product requirements, Q3 network and Q5 supportability | [REQUIREMENTS.md](../REQUIREMENTS.md) |
| Which commit a build comes from | **☰ → Help → About AgentEd** shows the version and the build commit, with **Copy** (Q5). Measured in the virtual machine: `Version 1.0.0`, `Build 881ea3a`. The CI artifact and the release are built from that commit |

## Known limits

| limit | status |
| --- | --- |
| **The Windows installer is not digitally signed.** SmartScreen and code-signing policies treat it as from an unknown publisher; the [README](../README.md#windows-installation) gives the steps | measured: the PE security directory of `AgentEd_1.0.0_x64-setup.exe` is empty, no Authenticode signature |
| **It installs per user, under `%LOCALAPPDATA%\AgentEd`**, the default of the Tauri installer; there is no per-machine option in 1.0.0 | measured |
| **AppLocker or Windows Defender Application Control rules that block programs in user profiles may stop AgentEd, whatever the network** | READING, not measured |
| **Windows 11** | not tested |
| **A standard user, and the UAC prompt** | not tested; the measurements ran as a local administrator |
| **A network behind a proxy** | not tested |
| **Group policies for WebView2** | not tested |
| **A launch with the runtime destinations dropped** | measured in one launch of each kind, with the hosts file standing in for a dropping firewall, see part 1; a real network firewall was not tested |

A per-machine install option would be a change to the installer, and its own issue.
