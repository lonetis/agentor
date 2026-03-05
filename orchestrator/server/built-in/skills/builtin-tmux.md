---
name: tmux
description: Manage tmux sessions, windows, and panes inside your worker container. Use when you need to run multiple processes side by side, create background tasks, or organize your terminal workspace.
user-invocable: false
---

# Manage tmux sessions, windows, and panes

Use this skill when you need to run multiple processes simultaneously, create background tasks, or organize your terminal workspace. Your worker runs inside a tmux session, so you can create additional windows and panes without any extra setup.

## Your tmux environment

You (the agent) are running inside a tmux session named `main`. Your process lives in a window of this session — you can run `tmux display-message -p '#W'` to see which window you're in. The dashboard terminal connects to the same session, so any windows or panes you create are visible to the user and vice versa. The first window is called `shell` and cannot be closed.

Since you're already inside tmux, you can use all `tmux` commands directly — no need to start or attach to a session first.

## Quick reference

### Sessions

```bash
# List all sessions
tmux list-sessions

# Create a new named session (detached)
tmux new-session -d -s mysession

# Attach to an existing session
tmux attach-session -t mysession

# Kill a session
tmux kill-session -t mysession

# Switch to another session (from inside tmux)
tmux switch-client -t mysession
```

### Windows (tabs)

Windows are like tabs within a session.

```bash
# List windows in the current session
tmux list-windows

# Create a new window
tmux new-window -t main

# Create a new window with a name
tmux new-window -t main -n mywindow

# Switch to a window by index
tmux select-window -t main:2

# Switch to a window by name
tmux select-window -t main:mywindow

# Rename the current window
tmux rename-window newname

# Close the current window
tmux kill-window

# Close a specific window
tmux kill-window -t main:mywindow
```

### Panes (splits)

Panes split a single window into multiple regions.

```bash
# Split horizontally (left/right)
tmux split-window -h

# Split vertically (top/bottom)
tmux split-window -v

# Switch between panes
tmux select-pane -t 0    # by index
tmux select-pane -L      # left
tmux select-pane -R      # right
tmux select-pane -U      # up
tmux select-pane -D      # down

# Close the current pane
tmux kill-pane

# Close a specific pane
tmux kill-pane -t 2
```

### Running commands in other windows/panes

```bash
# Send keys to a specific window (runs a command there)
tmux send-keys -t main:mywindow "npm run dev" Enter

# Send keys to a specific pane in a window
tmux send-keys -t main:mywindow.1 "tail -f logs.txt" Enter

# Create a new window and immediately run a command
tmux new-window -t main -n server "npm run dev"

# Run a command in a new detached pane
tmux split-window -d "python3 script.py"
```

### Capturing output

```bash
# Capture the visible content of a pane
tmux capture-pane -t main:mywindow -p

# Capture with scrollback history (last 1000 lines)
tmux capture-pane -t main:mywindow -p -S -1000

# Save captured output to a file
tmux capture-pane -t main:mywindow -p -S -1000 > /tmp/output.txt
```

## Common use cases

1. **Dev server + agent** — Create a window for your dev server (`npm run dev`) while continuing to work in the main window
2. **Background tasks** — Run builds, tests, or long-running processes in separate windows so they don't block your main workflow
3. **Log monitoring** — Split a pane to tail log files while working in the other half
4. **Multiple services** — Run a frontend, backend, and database each in their own window for a full-stack project
5. **Parallel operations** — Run multiple git clones, installs, or builds simultaneously in different windows
