# Codex Secure GitHub Access

This note records the local-tool setup and Codex sandbox workaround for GitHub-facing commands in this workspace.

## Rule

GitHub-facing `git` and `gh` commands must run through `secdat` so `GH_TOKEN` is injected from the local secure store instead of appearing in prompts, shell history, or persistent environment files.

Normal local inspection does not need `secdat`:

```bash
git status --short
git diff
git log --oneline
```

GitHub-facing commands should use:

```bash
secdat --dir /home/katsumata-m/mdv exec git ...
secdat --dir /home/katsumata-m/mdv exec gh ...
```

Use `--dir /home/katsumata-m/mdv` explicitly when the current shell may not be inside the workspace root.

## Codex Sandbox Workaround

`secdat unlock` uses a domain-scoped session agent under the normal user runtime locations. In this Codex CLI environment, direct tool execution may not see that active session even when the user's interactive shell has already unlocked it:

```bash
secdat --dir /home/katsumata-m/mdv domain status
secdat --dir /home/katsumata-m/mdv exec git status --short
```

If those commands report `locked` or `missing SECDAT_MASTER_KEY and no active secdat session`, run the secret-injected command through `ptyterm`:

```bash
ptyterm --create -- secdat --dir /home/katsumata-m/mdv exec git rev-parse --is-inside-work-tree
ptyterm --session=<id> --recv --recv-timeout=5s --recv-format=raw --recv-size=12000
```

For commands with no output on success, prefer a probe with expected output first, such as:

```bash
ptyterm --create -- secdat --dir /home/katsumata-m/mdv exec git rev-parse --is-inside-work-tree
```

Then run the real command:

```bash
ptyterm --create -- secdat --dir /home/katsumata-m/mdv exec gh pr status
ptyterm --session=<id> --recv --recv-timeout=10s --recv-format=raw --recv-size=20000
```

`ptyterm --create` may need sandbox approval because it talks to its daemon socket under `XDG_RUNTIME_DIR`.

## Tool Installation

The local tools are maintained in these GitHub repositories:

- [mako10k/secdat](https://github.com/mako10k/secdat)
- [mako10k/ptyterm](https://github.com/mako10k/ptyterm)

The install notes below were checked against those repositories on 2026-06-02.

### secdat

`secdat` is a C/Autotools project. Its README documents the build path:

```bash
git clone https://github.com/mako10k/secdat.git
cd secdat
./autogen.sh --profile build
./configure
make
sudo make install
```

For a fuller developer setup, the repo includes:

```bash
sudo ./scripts/bootstrap-system.sh --profile dev --install --assume-yes
./autogen.sh --profile dev --configure
make
```

Typical dependencies include a C compiler, GNU Autotools, libtool, pkg-config, gettext, and OpenSSL development headers. The repo's bootstrap helper supports Debian-family and Amazon Linux-family systems.

After install, initialize or refresh the MDV domain unlock from an interactive terminal:

```bash
secdat --dir /home/katsumata-m/mdv unlock
secdat --dir /home/katsumata-m/mdv domain status
```

### ptyterm

`ptyterm` is also a C/Autotools project. Its README documents:

```bash
git clone https://github.com/mako10k/ptyterm.git
cd ptyterm
./bootstrap.sh
./configure
make
sudo make install
```

Typical dependencies include autoconf, automake, libtool, and a C compiler.

Useful smoke checks:

```bash
ptyterm --help
ptyterm --daemon-status
ptyterm --create -- bash -lc 'echo hello'
ptyterm --session=<id> --recv --recv-timeout=2s --recv-format=raw
```

