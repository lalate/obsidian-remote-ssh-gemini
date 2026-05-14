# Gemini CLI & Obsidian Remote SSH Integration Requirements

## 1. Objective
Adapt `obsidian-remote-ssh` to serve as a mobile interface (iPhone) for Gemini CLI operations and document management. This allows users to execute complex AI-driven research and editing tasks from their phone while leveraging the power of a remote server.

## 2. Core Feature Requirements

### 2.1 RPC Protocol Extensions (Go Daemon)
Required additions to the JSON-RPC protocol to support CLI interaction.
- **`cli.exec`**: Execute a command and return full output (stdout/stderr) and exit code upon completion.
- **`cli.spawn`**: Start a long-running process and stream output back to the client via notifications.
- **`cli.kill`**: Terminate a running process.
- **Working Directory Control**: Ensure commands run in the context of the Obsidian vault root.

### 2.2 Mobile Interface Enhancements (Obsidian Plugin)
UI/UX features optimized for mobile constraints.
- **Streaming Terminal View**: A dedicated view to display real-time output from `cli.spawn`.
- **Command Palette Integration**: Quick access to common Gemini CLI commands without typing.
- **Editor Context Sharing**: Ability to send the current note's content or selected text as input to Gemini CLI.
- **Prompt Templates**: Pre-defined command structures (e.g., "Summarize", "Code Review") to minimize mobile typing.

### 2.3 Gemini CLI Optimization
Adjustments for remote/non-interactive execution.
- **Headless Mode**: Robust execution in environments with incomplete TTY.
- **Log Synchronization**: Remote access to `pipeline_helper.log`.
- **FS Synergy**: Leveraging existing `fs.*` RPC methods for instant file updates in Obsidian.

### 2.4 Security & Robustness
- **Session Persistence**: Allow tasks to continue on the server if the mobile WebSocket disconnects (and sync back on reconnect).
- **Execution Whitelisting**: Restrict execution to specific commands (e.g., `gemini`, `git`) for security.

## 3. Next Steps
1. Define the detailed JSON-RPC message structures for `cli.*` methods.
2. Implement the `cli.exec` logic in the Go daemon (`server/`).
3. Prototype the Terminal View in the mobile-compatible part of the plugin (`mobile/`).
