# Sbx (Bun/TypeScript Version)

> [!NOTE]
> This project is a derived work from [AkihiroSuda/alcless](https://github.com/AkihiroSuda/alcless).

Isolated macOS user sessions with pre-baked tools. Fast, focused, and one-shot.

## Why Sbx?

When running autonomous coding agents on your local machine, there's always a risk of unintended side effects: accidental file deletion, configuration corruption, or exposure of personal files. 

**Sbx** solves this by leveraging macOS's native `sysadminctl` to create several lightweight, isolated sandboxes. This allows you to:
*   **Limit Risk**: Run agents in a dedicated user session where they can't touch your main home directory.
*   **Keep it Lightweight**: Unlike heavy VMs or Docker containers that struggle with macOS integration, Sbx uses native system accounts.
*   **Ready to Code**: Each session comes pre-provisioned with a modern development toolchain.

## Quick Start

### Installation

Ensure you have [Bun](https://bun.sh) installed.

```bash
git clone https://github.com/AkihiroSuda/sbx.git
cd sbx
make setup
```

### Common Commands

The easiest way to interact with Sbx is via `make`:

| Action | Command |
| :--- | :--- |
| **Create** | `make create NAME="sbox1 sbox2"` |
| **List** | `make list` |
| **Delete** | `make delete NAME="sbox1"` |
| **Clean All** | `make clean` |
| **Test** | `make test` |

> [!TIP]
> To enter a session manually: `./bin/sbx exec sbox1`

## Pre-installed Toolchain

Every session is automatically provisioned with:
*   **GitHub CLI (`gh`)**: For repository interactions.
*   **`jq`**: For JSON processing.
*   **Python 3.12**: Managed via `uv`.
*   **UV**: Ultra-fast Python package installer and resolver.
*   **Bun**: Fast JavaScript runtime and package manager.

## Customization

### Adding more tools
If you need to include additional tools (e.g., `ffmpeg`, `go`, `rust`) in every new session, you can modify the provisioning script:

1.  Open `src/lib/provision.ts`.
2.  Update the `installCmd` array with your desired installation commands (usually via `curl` or `brew` if available).
3.  New sandboxes created after this change will include your new tools.

## Security & Permissions

### Suppressing the "Administration" Popup
On modern macOS, `sysadminctl` triggers a GUI prompt. To run `sbx` silently:
1.  Open **System Settings**.
2.  Go to **Privacy & Security** > **Full Disk Access**.
3.  Add and toggle your Terminal (e.g., **Ghostty**, **Terminal.app**, or **iTerm2**) to **ON**.
4.  Restart your terminal.

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

In summary, Sbx is intended to make running coding agents "safer" than "yolo" mode on your main account, without the friction and performance cost of a full Virtual Machine.

## License

MIT
