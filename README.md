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

### Common Commands

The easiest way to interact with Sbx is via `make`:

| Action | Command |
| :--- | :--- |
| **Create** | `make create NAME="sbox1 sbox2"` |
| **Create with Tools** | `make create NAME="sbox1" TOOLS="gh,jq,ffmpeg"` |
| **List** | `make list` |
| **Enter Session** | `make exec NAME="sbox1"` |
| **Delete** | `make delete NAME="sbox1"` |
| **Clean All** | `make clean` |
| **Test** | `make test` |

## Interacting with Sessions

Once a session is created, you can interact with it in several ways:

### 1. Interactive Shell
To drop into an interactive `zsh` session as the sandbox user:
```bash
make exec NAME="sbox1"
# or
./bin/sbx exec sbox1
```

### 2. Run a Single Command
To run a command and return immediately:
```bash
make exec NAME="sbox1" CMD="ls -la"
# or
./bin/sbx exec sbox1 "ls -la"
```

### 3. Sudo Access
The sandbox user has full `sudo` privileges. You can perform administrative tasks inside the session without affecting the host:
```bash
make exec NAME="sbox1" CMD="sudo port install top"
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
make create NAME="mysession" TOOLS="gh,jq,python,ffmpeg"

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
*   **File System**: Each sandbox has its own home directory (`/Users/sbx_...`) with permissions set to `700`. It cannot access your host user's files (provided your home directory has standard restrictive permissions).
*   **Processes**: Processes running inside the sandbox are owned by the sandbox user. They can see system-wide processes but cannot modify or terminate them.
*   **Network**: Sandboxes have **full internet access** by default. There is no network-level sandboxing or firewalling included.

### What Sbx is NOT
*   **Not a Bunker**: Sbx is designed to be a "seatbelt" to prevent common "footguns" (like an autonomous agent accidentally deleting your home directory or messing up your config files). It does not provide "hardcore" security against determined attackers.
*   **No Kernel Protection**: It does not protect against kernel-level exploits or hardware-level vulnerabilities.
*   **Resource Management**: A compromised or rogue agent inside a sandbox can still consume 100% of your CPU/GPU or be used to mine cryptocurrency.
*   **No IP Isolation**: Since there is no network isolation, any malicious activity will appear as coming from your machine's IP address.

In summary, Sbx is intended to make running coding agents **safer when running in "yolo" mode** on your main account, providing a disposable environment with full sudo access while keeping your host user space protected.

## License

MIT
