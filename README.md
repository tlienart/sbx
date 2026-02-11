# `sbx` lightweight sandbox for macOS

> [!NOTE]
> This project is a derived work from [AkihiroSuda/alcless](https://github.com/AkihiroSuda/alcless).

Isolated macOS user sessions with a fast, on-demand toolchain. Fast, focused, and one-shot.

## Why Sbx?

When running autonomous coding agents on your local machine, there's always a risk of unintended side effects: accidental file deletion, configuration corruption, or exposure of personal files. 

**Sbx** solves this by leveraging macOS's native `sysadminctl` to create several lightweight, isolated sandboxes. This allows you to:
*   **Limit Risk**: Run agents in a dedicated user session where they can't touch your main home directory.
*   **Keep it Lightweight**: Unlike heavy VMs or Docker containers that struggle with macOS integration, Sbx uses native system accounts.
*   **Ready to Code**: Each session comes pre-configured with a modern, on-demand toolchain powered by `pkgx`.

## Quick Start

### Installation

```bash
git clone https://github.com/tlienart/sbx.git
cd sbx
make install
```

### Sandboxed Authentication

Sbx includes a unique "interception" mechanism that allows tools inside the sandbox to perform authenticated operations (like `git push` or calling LLM APIs) **without the sandbox ever having access to your secrets**.

### How it Works
1.  **Intercepted Commands**: When you run `git` or `gh` inside the sandbox, the request is transparently forwarded to a "Bridge" running on your host.
2.  **Host Execution**: The host executes the command using its own isolated environment and your provided secrets, then streams the result back to the sandbox.
3.  **API Proxy**: For tools like **OpenCode**, a local proxy intercepts requests to LLM providers (Google, OpenAI, Anthropic) and injects the API keys on the host side.

### Setup

To enable this, set the following environment variables on your **host**, or create a `.env` file in the `sbx` project root:

```bash
# GitHub Authentication (for git and gh)
SBX_GITHUB_TOKEN="your_pat_token"

# LLM API Keys (for OpenCode)
SBX_GOOGLE_API_KEY="your_key"
SBX_OPENAI_API_KEY="your_key"
SBX_ANTHROPIC_API_KEY="your_key"
```

### GitHub PAT Guide
For maximum security, it is recommended to create a **Fine-grained Personal Access Token**:
1.  Go to **GitHub Settings** > **Developer Settings** > **Personal Access Tokens** > **Fine-grained tokens**.
2.  Click **Generate new token**.
3.  **Repository selection**: Select "Only select repositories" and pick the ones you want the sandbox to access.
4.  **Permissions**:
    *   **Issues**: Read and Write
    *   **Pull requests**: Read and Write
    *   **Metadata**: Read-only
5.  This allows the sandbox (via the host bridge) to open issues, PRs, and comment, but it cannot delete repositories or access your private data outside the selection.

## Demo Walkthrough

Follow these steps to see Sbx's sandboxed authentication in action.

### 1. Set Host Secrets
On your **host machine**, set the environment variables that Sbx will use to bridge authentication:

```bash
export SBX_GITHUB_TOKEN="ghp_your_token_here"
export SBX_GOOGLE_API_KEY="AIzaSyYourKeyHere"
```

### 2. Create and Enter the Sandbox
Create a new sandbox named `demo` configured for the `google` provider:

```bash
make create name="demo" provider="google"
make exec name="demo"
```

### 3. Verify GitHub Authentication
Inside the sandbox, check your GitHub status:

```bash
gh auth status
```
*Result:* You'll see you are authenticated via the host's token, even though the token itself is not in the sandbox.

### 4. Verify OpenCode (LLM) Access
Try running a prompt with OpenCode:

```bash
opencode "say hello"
```
*Result:* The request is proxied to the host, which injects your `SBX_GOOGLE_API_KEY` before forwarding it to Google.

### 5. Confirm No Secrets are Exposed
**Crucially, your secrets never leave your host user space.** Verify that your sensitive keys are nowhere to be found inside the sandbox:

```bash
# Check environment variables
env | grep -E "SBX|GOOGLE|GITHUB"

# Check OpenCode configuration
cat ~/.config/opencode/opencode.json
```
*Result:* You will see `SBX_PROXY_ACTIVE` instead of your actual keys. 

## Common Commands

The easiest way to interact with Sbx is via `make`:

| Action | Command |
| :--- | :--- |
| **Create** | `make create name="sbox1 sbox2"` |
| **Create with Tools** | `make create name="sbox1" tools="gh,jq,ffmpeg"` |
| **List** | `make list` |
| **Enter Session** | `make exec name="sbox1"` |
| **Delete** | `make delete name="sbox1"` |
| **Clean All** | `make clean` |
| **Test** | `make test` |

...

### 2. Run a Single Command
To run a command and return immediately:
```bash
make exec name="sbox1" cmd="ls -la"
# or
./bin/sbx exec sbox1 "ls -la"
```

### 3. Sudo Access
The sandbox user has full `sudo` privileges. You can perform administrative tasks inside the session without affecting the host:
```bash
make exec name="sbox1" cmd="sudo port install top"
```

### 4. Exit
To leave the session, simply type `exit` or press `Ctrl-D`.

## Toolchain (Powered by pkgx)

Every session is automatically configured with **[pkgx](https://pkgx.sh)**. 

*   **Fast Provisioning**: Since tools are fetched on-demand, creating a new session takes less than 5 seconds.
*   **Thousands of Tools**: You can run almost any developer tool (e.g., `gh`, `jq`, `python`, `node`, `go`, `rust`, `ffmpeg`) just by typing its name.
*   **Seamless Integration**: `pkgx` is integrated into the shell. The first time you run a tool, it's transparently downloaded and executed.

## Customization

### Requesting specific tools
If you want certain tools to be pre-cached (so they are available instantly on first use), use the `TOOLS` variable:

```bash
# Via make
make create name="mysession" tools="gh,jq,python,ffmpeg"

# Via CLI
./bin/sbx create mysession --tools "gh,jq,python,ffmpeg"
```

## Security & Permissions

### Suppressing the "Administration" Popup
On modern macOS, `sysadminctl` requires elevated permissions to manage system accounts. By default, this triggers a GUI prompt for every sandbox created. To allow Sbx to run silently, you must grant your terminal **Full Disk Access**:

1.  Open **System Settings**.
2.  Go to **Privacy & Security** > **Full Disk Access**.
3.  Add and toggle your Terminal (e.g., **Ghostty**, **Terminal.app**, or **iTerm2**) to **ON**.
4.  Restart your terminal.

> [!NOTE]
> Granting Full Disk Access is a standard requirement for system management tools on macOS. For more context, see [Apple's official documentation on controlling access to files and folders](https://support.apple.com/guide/mac-help/control-access-to-files-and-folders-on-mac-mchl534c31f1/mac).

## Technical Details

### How it Works
Sbx uses the native macOS `sysadminctl` utility to create a genuine, standard macOS user account for each sandbox. This leverages the operating system's built-in process and file isolation.

### Separation & Security Model
*   **File System Isolation**: Each sandbox has its own home directory (`/Users/sbx_...`) locked to `700` (`drwx------`). This ensures that `Sandbox A` cannot list or read files from `Sandbox B`.
*   **Host Bridge Access (ACLs)**: The host user is granted explicit access to sandbox homes via macOS Access Control Lists (ACLs). Inheritance flags (`file_inherit`, `directory_inherit`) ensure that any new files created by the sandbox remain accessible to the host bridge.
*   **Host Home Protection**: Sandboxes cannot access your host user's files (provided your host home is `700`).
*   **System `/tmp`**: Sandboxes have access to the system `/tmp` (standard macOS `1777`), which is required for many core tools to function. Sensitive data should never be stored in the system `/tmp`.
*   **Processes**: Processes running inside the sandbox are owned by the sandbox user. They can see system-wide processes but cannot modify or terminate them.
*   **Network**: Sandboxes have **full internet access** by default. There is no network-level sandboxing or firewalling included. Malicious activity will appear as coming from your IP.
*   **Secrets**: Secrets (API keys, GitHub tokens) are **never stored or visible** inside the sandbox. They stay on the host and are used by the Bridge to sign requests on behalf of the sandbox.

### Bridge Hardening
The Sbx Host Bridge is reinforced with several security layers:
*   **Path Traversal Protection**: All `cwd` (working directory) requests from the sandbox are normalized using absolute path resolution. The bridge strictly rejects any command that resolves outside the designated `/Users/sbx_` prefix.
*   **Unix Socket Isolation**: Communication sockets are protected using macOS Access Control Entries (ACLs). Only the host user and the specific sandbox user are granted `read/write` access to the bridge.
*   **Argument Sanitization**: The bridge implements a strict blocklist for dangerous command-line flags. For example, `git --exec-path` or `gh extension` are blocked to prevent the sandbox from executing arbitrary binaries or installing untrusted code on the host.

### What Sbx is NOT
*   **Not a Bunker**: Sbx is a "seatbelt" to prevent common "footguns" (like an agent deleting your files). It is not a hardened container for running untrusted malware.
*   **No Kernel Protection**: It does not protect against kernel-level exploits.
*   **Resource Management**: A rogue agent can still consume 100% of your CPU/GPU or mine cryptocurrency.
*   **No IP Isolation**: Any network activity will use your host's network identity.

### Sudo Access
By default, the host user can run commands as the sandbox user without a password. Inside the sandbox, the user is a **standard macOS user**. While they can use `sudo` if configured, the primary way to perform administrative tasks is via the host's `sbx exec` command.


In summary, Sbx is intended to make running coding agents **safer when running in "yolo" mode** on your main account, providing a disposable environment with full sudo access while keeping your host user space protected.

## Zulip Integration

You can interact with Sbx sandboxes through Zulip. This allows you to manage multiple sandboxes as separate topics in a stream.

### 1. Zulip Bot Setup
1. **Create Organization**: If you don't have one, create a free organization at [zulipchat.com](https://zulipchat.com/new/).
2. **Create a Bot**:
   - Go to **Settings** (gear icon) -> **Personal settings** -> **Bots** -> **Add a new bot**.
   - **Bot type**: Generic bot.
   - **Full name**: `Sbx Bot`
   - **Bot email**: Take note of the generated email (e.g., `sbx-bot@yourorg.zulipchat.com`).
   - Click **Create bot**.
3. **Get Credentials**:
   - Click the **Download zuliprc** (download icon) in the bot list.
   - Open the downloaded file to find your `api_key`.
   - Note your organization's URL (e.g., `https://yourorg.zulipchat.com`).

### 2. Environment Configuration
Add the following to your host's `.env` file or export them in your shell:
```bash
SBX_ZULIP_SITE="https://yourorg.zulipchat.com"
SBX_ZULIP_USERNAME="sbx-bot@yourorg.zulipchat.com"
SBX_ZULIP_API_KEY="your_api_key_here"
SBX_ZULIP_DEFAULT_STREAM="general"
```

### 3. Starting the Bot
Run the following command on your host:
```bash
sbx bot
```

### 4. Testing the Bridge
1. In Zulip, send a message to the bot (or in the default stream): `/new my-task`.
2. The bot will create a new topic named `sbx-my-task`.
3. In that topic, send a prompt like: `opencode "say hello"`.
4. The request will flow from Zulip -> Bot -> Sandbox -> Host Bridge -> LLM Provider and back.
5. **Multi-turn conversation**: The bot remembers context within each topic. To start fresh, use the `/restart` command in the topic.
6. **Utility Commands**:
   - `/status`: Check the bot and agent status.
   - `/mode`: List available modes.
   - `/switch <mode>`: Switch between `plan`, `build`, and `research`.
   - `/interrupt`: Stop the current running task.

## License

MIT
