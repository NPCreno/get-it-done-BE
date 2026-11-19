# Connect an AI assistant (MCP)

Get It Done runs an MCP server, so an AI assistant can read and manage your tasks and projects for you. It works with any client that can send an `Authorization` header: Claude Code, Cursor, the MCP Inspector and others.

**Server URL:** `https://get-it-done-be.onrender.com/mcp` (Streamable HTTP)

> The first call after about 15 idle minutes can take ~50 seconds while the server wakes up (Render free tier). If your client times out, try again.

## 1. Create a token
1. Sign in to Get It Done and open **Profile → Connect an AI assistant**.
2. Click **Create token**, give it a name ("Claude Code on my laptop") and pick an expiry: 30, 90 (default) or 365 days, or no expiry.
3. Copy the token (it starts with `gid_pat_`). **It is shown once.** If you lose it, revoke it and create another.

Treat a token like a password: anyone who has it can read and change your tasks. You can have up to 10 active tokens and revoke any of them at any time; a revoked token stops working on the next request. A token works only on the MCP server, never on the website's API.

## 2. Add it to your client

### Claude Code
```bash
claude mcp add --transport http get-it-done https://get-it-done-be.onrender.com/mcp --header "Authorization: Bearer <your token>"
```
Then ask, for example: "What's due today in Get It Done?" Remove it with `claude mcp remove get-it-done`.

### Cursor
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

### MCP Inspector
CLI:
```bash
npx @modelcontextprotocol/inspector@2.16.0 --cli https://get-it-done-be.onrender.com/mcp --transport http --header "Authorization: Bearer $GID_TOKEN" --method tools/list
```
Web UI: `npx @modelcontextprotocol/inspector@2.16.0`, then Transport **Streamable HTTP**, URL `https://get-it-done-be.onrender.com/mcp`, Authentication **Bearer token**.

claude.ai, the Claude desktop app and the phone app need a connector sign-in (OAuth). That comes in a later release.

## What the assistant can do
Every tool acts only on your own data, plus the chat of projects shared with you. Dates are ISO 8601 in UTC.

| Tool | What it does |
|---|---|
| `get_profile` | Your username, full name, email and theme |
| `get_dashboard` | The dashboard numbers (tasks in a window, to do, completed, projects, streak); the window defaults to today |
| `list_notifications`, `mark_notification_read` | Your notifications |
| `list_tasks` | Your tasks, filtered by status, project, due dates, title text; up to 100 |
| `get_task` | One task with its sub-tasks |
| `create_task` | A task or a recurring series (same rules as the website) |
| `update_task` | Title, description, due date, priority, project |
| `set_task_status` | Pending, Complete or Overdue (completing counts toward awards, as on the website) |
| `add_subtask`, `set_subtask_status` | Sub-tasks |
| `list_projects`, `get_project` | Projects with task counts |
| `create_project`, `update_project` | Projects; colors are the website's palette (Lavender, Mint, Peach, Sky, Lemon, Rose, Mauve, Baby Blue, Coral, Seafoam) |
| `delete_task`, `delete_subtask`, `delete_project` | Deletes. Your client asks you first. Deletes are soft: the item disappears from lists but is kept, and support can restore it |
| `list_shared_projects`, `list_chat_messages`, `get_chat_unread` | Read the chat of projects you own or that are shared with you (sending messages is not supported) |

## Limits and errors
- 120 requests per minute per token; past that the server answers 429 with `Retry-After`.
- A missing, expired or revoked token gets 401 (`WWW-Authenticate: Bearer`).
- Requests from a web page (an `Origin` header) are refused unless that origin is allowed by the server's operator.
- A tool that cannot do what you asked returns an error with a short reason ("Task not found", a validation message). Someone else's task and a task that does not exist give the same answer.
