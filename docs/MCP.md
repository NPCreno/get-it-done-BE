# Connect an AI assistant (MCP)

Get It Done runs an MCP server, so an AI assistant can read and manage your tasks and projects for you. There are two ways to connect:
- **Sign in (OAuth), recommended:** claude.ai, the Claude desktop and phone apps, Claude Code, the MCP Inspector and other clients that support MCP sign-in. You paste the server URL, sign in on our website and approve. No token to copy.
- **Personal access token:** any client that can send an `Authorization` header (Cursor, scripts).


**Server URL:** `https://get-it-done-be.onrender.com/mcp` (Streamable HTTP)

> The first call after about 15 idle minutes can take ~50 seconds while the server wakes up (Render free tier). **If Claude says it couldn't connect, the server was asleep. Wait a minute and try again.** Your client may time out the same way.

## Connect with sign-in (OAuth)

### claude.ai, Claude desktop, Claude phone app
1. In claude.ai open **Settings → Connectors → Add custom connector**.
2. Name it "Get It Done" and paste `https://get-it-done-be.onrender.com/mcp`. Leave the advanced settings (client ID, secret) empty.
3. Click **Connect**. Claude opens our website: sign in if asked, check that the app is the one you expect, then click **Allow**.
4. You're back in Claude, connected. The connector also appears in the desktop and phone apps.

### Claude Code
```bash
claude mcp add --transport http get-it-done https://get-it-done-be.onrender.com/mcp
```
Then type `/mcp` in Claude Code, pick **get-it-done** and choose **Authenticate**. Your browser opens our consent page; approve, then return to Claude Code.

### MCP Inspector
Web UI: `npx @modelcontextprotocol/inspector@2.16.0`, Transport **Streamable HTTP**, URL `https://get-it-done-be.onrender.com/mcp`, then **Open Auth Settings → Quick OAuth Flow** (or the guided flow), approve on our site, and **Connect**.

### What you see and what the app gets
- The consent page names the app (as it registered itself), where you'll be sent back (for example `claude.ai`, or `localhost` for an app on your computer), and what it may do: read and change your tasks and projects, and stay connected until you disconnect.
- The app gets a 1-hour access token and a refresh token (rotated on every use, 30 days without use at most). After 180 days you sign in again.
- Tokens work only on the MCP server, never on the website's API.

### Disconnect
**Profile → Connected apps → Disconnect** ends the app's access at once (all its tokens).

## Connect with a personal access token

### 1. Create a token
1. Sign in to Get It Done and open **Profile → Connect an AI assistant**.
2. Click **Create token**, give it a name ("Claude Code on my laptop") and pick an expiry: 30, 90 (default) or 365 days, or no expiry.
3. Copy the token (it starts with `gid_pat_`). **It is shown once.** If you lose it, revoke it and create another.

Treat a token like a password: anyone who has it can read and change your tasks. You can have up to 10 active tokens and revoke any of them at any time; a revoked token stops working on the next request. A token works only on the MCP server, never on the website's API.

### 2. Add it to your client

#### Claude Code (with a token)
```bash
claude mcp add --transport http get-it-done https://get-it-done-be.onrender.com/mcp --header "Authorization: Bearer <your token>"
```
Then ask, for example: "What's due today in Get It Done?" Remove it with `claude mcp remove get-it-done`.

#### Cursor
In `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):
```json
{
  "mcpServers": {
    "get-it-done": {
      "url": "https://get-it-done-be.onrender.com/mcp",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}
```

#### MCP Inspector (with a token)
CLI:
```bash
npx @modelcontextprotocol/inspector@2.16.0 --cli https://get-it-done-be.onrender.com/mcp --transport http --header "Authorization: Bearer $GID_TOKEN" --method tools/list
```
Web UI: `npx @modelcontextprotocol/inspector@2.16.0`, then Transport **Streamable HTTP**, URL `https://get-it-done-be.onrender.com/mcp`, Authentication **Bearer token**.


## What the assistant can do
Every tool acts only on your own data, plus the chat of projects shared with you. Dates are ISO 8601 in UTC.

| Tool | What it does |
|---|---|
| `get_profile` | Your username, full name, email and theme |
| `get_dashboard` | The dashboard numbers (tasks in a window, to do, completed, projects, streak); the window defaults to today |
| `list_notifications`, `mark_notification_read` | Your notifications |
| `list_tasks` | Tasks you're responsible for (yours, or assigned to you in shared projects), filtered by status, project, due dates, title text; up to 100. With a project: every task in that project |
| `get_task` | One task with its sub-tasks (yours, or in a project you own or that is shared with you) |
| `create_task` | A task or a recurring series (same rules as the website) |
| `update_task` | Title, description, due date, priority, project |
| `set_task_status` | Pending, Complete or Overdue (completing counts toward awards, as on the website) |
| `add_subtask`, `set_subtask_status` | Sub-tasks |
| `list_projects`, `get_project` | Projects with task counts |
| `create_project`, `update_project` | Projects; colors are the website's palette (Lavender, Mint, Peach, Sky, Lemon, Rose, Mauve, Baby Blue, Coral, Seafoam) |
| `delete_task`, `delete_subtask`, `delete_project` | Deletes. Your client asks you first. Deletes are soft: the item disappears from lists but is kept, and support can restore it |
| `list_shared_projects`, `list_chat_messages`, `get_chat_unread` | Read the chat of projects you own or that are shared with you (sending messages is not supported) |

## Limits and errors
- 120 requests per minute per token or connected app; past that the server answers 429 with `Retry-After`.
- A missing, expired or revoked token gets 401 with `WWW-Authenticate: Bearer error="invalid_token", ..., scope="mcp", resource_metadata="https://get-it-done-be.onrender.com/.well-known/oauth-protected-resource/mcp"`, which sign-in clients use to find our authorization server.
- Requests from a web page (an `Origin` header) are refused unless that origin is allowed by the server's operator.
- A tool that cannot do what you asked returns an error with a short reason ("Task not found", a validation message). Someone else's task and a task that does not exist give the same answer.
