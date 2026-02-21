# macOS Packet Filter (PF) Evaluation for SBX

SBX uses the native macOS Packet Filter (PF) to restrict sandbox network access. However, for these restrictions to actually be enforced by the macOS kernel, your system must be configured to evaluate the rules SBX creates.

## The Mechanism

SBX places its firewall rules into a specific **anchor** (a sub-ruleset) named `com.apple/sbx`. This keeps SBX rules isolated from your system's main firewall rules.

PF works in a hierarchy. When a network packet is sent, the kernel reads the main ruleset (usually `/etc/pf.conf`). It only dives into an anchor if the main ruleset explicitly tells it to.

## Requirements for Network Restriction

To ensure the "Network Lock" works correctly, you must verify two things:

### 1. PF must be Enabled
Even if rules are loaded, they do nothing if PF is disabled. SBX attempts to enable it automatically using `pfctl -e`, but some system configurations or third-party firewalls might interfere.

**Check status:**
```bash
sudo pfctl -s info | grep Status
```

### 2. The Anchor must be Referenced
Your main `/etc/pf.conf` must contain a reference that covers the SBX namespace. Most macOS versions include this by default:

```pf
anchor "com.apple/*"
load anchor "com.apple" from "/etc/pf.anchors/com.apple"
```

If your `/etc/pf.conf` has been heavily customized or is missing these lines, the SBX rules in `com.apple/sbx/...` will be ignored by the kernel.

## Troubleshooting

### Verify rules are loaded
While a restricted sandbox is running, you can see the active rules for its specific UID:

```bash
# Replace <uid> with the numeric UID of the sandbox (found in 'sbx list' or 'id')
sudo pfctl -a "com.apple/sbx/uid_<uid>" -s rules
```

If you see `block out proto tcp all user <uid> ...`, the rule is successfully **loaded** into memory. If it's loaded but you can still `curl` from the sandbox without a proxy, then PF is either **disabled** or **not evaluating** that anchor.

### How to Fix Evaluation
If the rules are ignored, ensure your `/etc/pf.conf` contains the following at the end of the file:

```pf
anchor "com.apple/*"
```

Then reload the main configuration:
```bash
sudo pfctl -f /etc/pf.conf
```

## Why this is "Clean"
By using the `com.apple/` prefix, SBX attempts to "piggyback" on the existing anchor structure Apple uses for its own internal services (like the application firewall), minimizing the need for users to manually edit system configuration files.
