# Fedora GNOME host support

OmarchyRemote retains its Omarchy adapters and adds **Applications** (search
and launch installed .desktop files via gio) plus a **KDE Connect** companion.

## Prerequisites

Run on Fedora GNOME as the logged-in desktop user. Install via Fedora packages:

    sudo dnf install tmux ptyxis gnome-shell-extension-gsconnect

Enable GSConnect in GNOME Extensions and pair the KDE Connect iPhone app on
the same network. GSConnect is the GNOME KDE Connect-compatible backend; do
not run KDE Connect's independent desktop backend beside it. KDE Connect's
**Remote Input** feature remains available separately for mouse and keyboard
control, while OmarchyRemote now offers an embedded touchpad on the KDE Connect
card for hosts with the optional `wdotool` executable.

### Embedded touchpad on Fedora GNOME

Install [wdotool](https://github.com/cushycush/wdotool/releases/latest) as the
logged-in Fedora user, using the release RPM downloaded for your architecture
(for example, `sudo dnf install ./wdotool-*.x86_64.rpm`) or `cargo install
wdotool`. GNOME 46+ with `xdg-desktop-portal-gnome` supports a RemoteDesktop
portal; run `wdotool --backend libei info` in the **desktop user session**
to inspect availability before opening the phone app.

The embedded touchpad uses **only** `wdotool --backend libei`, so it never
falls back to unprivileged/compositor-specific inputs or `/dev/uinput`.
The first touchpad event may cause a desktop RemoteDesktop permission prompt:
approve it on the Fedora host. The service needs the logged-in user's
`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, session D-Bus and other display
environment variables. If the host cannot get permission or lacks libei,
the app shows an error rather than bypassing GNOME input restrictions.
The `wdotool` GNOME path is not yet verified on this user's real Fedora session.

One-finger drag moves the pointer; one-finger tap left-clicks; two-finger tap
right-clicks and two-finger drag scrolls. Separate Left/Right click and scroll
buttons are available for accessibility. Events are bounded on the server.
Touchpad input follows the currently focused GNOME window; it is not bound
to a particular app. No Fedora screen capture, remote keyboard, or video
streaming is provided by this embedded component.

The OmarchyRemote KDE Connect card shows whether GSConnect and kdeconnect-cli
are present. CLI pairing and sending files from the Fedora home directory
work only if the **separate kdeconnect-cli binary** is installed. GSConnect
pairing and file sending remain available in its own native GNOME UI.
iPhone-to-Fedora file uploads are already available through **Files** without
KDE Connect. Only files inside the authenticated user's HOME can be sent
through the new CLI endpoint.

If a GUI launcher cannot access your active display, open a terminal inside
your GNOME session and import the display environment into your user manager:

    dbus-update-activation-environment --systemd DISPLAY WAYLAND_DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE XAUTHORITY

Do not restart a backend while someone is using an old remote-owned PTY: a
restart closes such shells. Keep the web gateway behind a private HTTPS
network such as Tailscale Serve; anyone able to reach it can use your shell.

## Shared terminal behavior

When both tmux and Ptyxis are available on Fedora, new phone shell tabs
request one tmux session also opened in a **Ptyxis** desktop window. Already
saved non-shared remote-only shells keep their previous behavior. In the
Terminal toolbar:

- **New on Fedora** creates a tmux session and requests a visible Ptyxis window.
- **Find sessions** lists the logged-in user's available tmux sessions.
- **Attach** connects the phone to the selected existing tmux session.

Input on either device goes to the same running tmux shell. Closing a shared
phone tab detaches it; the tmux server and desktop window keep running.
After a backend restart, use **Find sessions** to reattach. The backend
validates session names and passes argv without invoking a shell.
Different phone and desktop terminal widths can result in tmux resizing.

**Limits:** Ordinary already-open Fedora terminals cannot be adopted unless
they were started in tmux. A successful Ptyxis process spawn only confirms
the launch was requested, not that the desktop window was visually verified.
Screen sharing is not implemented by this adapter.

**Lume** is a separate terminal emulator with its own QR-paired phone
client and direct sharing of its own PTYs. Open Lume's **Control remotely**
feature to control existing Lume terminal tabs. OmarchyRemote does not
intercept those private Lume PTYs: its shared-terminal bridge uses tmux and
Ptyxis instead.

## Testing requirements

The Rust backend still depends on the sibling Corral server crate at
../Corral/server. The full Cargo build/test/clippy checks require it.
The web tests require npm dependencies and, for UI tests, Playwright.
These integration instructions do not install packages or change GNOME
settings automatically.