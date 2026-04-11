# openclaw-milky

OpenClaw channel plugin for QQ via the [Milky](https://milky.ntqqrev.org/) protocol.

Uses [LagrangeV2.Milky](https://github.com/LagrangeDev/Lagrange.Core) as the protocol endpoint.

QQ 交流群：529674493

## Installation

```bash
cd ~/.openclaw/extensions
git clone https://github.com/AI1379/openclaw-milky.git
cd openclaw-milky
pnpm install
```

## Configuration

Add to your `openclaw.json`:

```json
{
  "channels": {
    "milky": {
      "accounts": {
        "default": {
          "baseURL": "http://127.0.0.1:3000",
          "token": "",
          "enabled": true,
          "connectionKind": "websocket",
          "dmPolicy": "allowlist",
          "allowedUserIds": ["你的QQ号"],
          "groupPolicy": "allowlist",
          "allowedGroups": ["群号1", "群号2"],
          "groupMentionOnly": true,
          "groupLogDir": "~/.openclaw/workspace/logs/milky-groups",
          "autoAcceptFriendRequest": true,
          "autoAcceptGroupInvitation": true
        }
      }
    }
  }
}
```

### Configuration Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `baseURL` | string | `http://127.0.0.1:3000` | Lagrange.Milky HTTP API 地址 |
| `token` | string | `""` | API 访问令牌（Lagrange 通常不需要，留空即可） |
| `enabled` | boolean | `true` | 是否启用此账号 |
| `connectionKind` | `"websocket"` \| `"sse"` \| `"auto"` | `"websocket"` | 事件流传输方式 |
| `dmPolicy` | `"allowlist"` \| `"open"` | `"allowlist"` | 私聊策略：`allowlist` 仅白名单用户，`open` 所有人 |
| `allowedUserIds` | string[] | `[]` | 私聊白名单 QQ 号列表（`dmPolicy=allowlist` 时生效） |
| `groupPolicy` | `"all"` \| `"allowlist"` | `"all"` | 群消息策略：`all` 所有群，`allowlist` 仅 `allowedGroups` 中的群 |
| `allowedGroups` | string[] | `[]` | 群白名单（`groupPolicy=allowlist` 时生效） |
| `groupMentionOnly` | boolean | `false` | 是否开启仅 @bot 回复模式（见下方说明） |
| `groupLogDir` | string | `~/.openclaw/workspace/logs/milky-groups` | 群消息 JSONL 日志目录 |
| `autoAcceptFriendRequest` | boolean | `true` | 自动接受白名单用户的好友请求 |
| `autoAcceptGroupInvitation` | boolean | `true` | 自动接受群邀请 |
| `botQQ` | number \| null | `null` | Bot 的 QQ 号（通常自动检测，无需手动设置） |

### groupMentionOnly 模式

当 `groupMentionOnly: true` 时：

- **只有 @bot 的消息**会进入 agent 上下文并触发回复
- **所有群消息**都会被记录到 JSONL 日志文件中，可通过 skill 读取
- 此选项与 `groupPolicy` **正交组合**：

| groupPolicy | groupMentionOnly | 效果 |
|---|---|---|
| `"all"` | `false` | 所有群的所有消息都进上下文（默认行为） |
| `"all"` | `true` | 所有群的消息记录日志，仅 @bot 进上下文 |
| `"allowlist"` | `false` | 仅白名单群的所有消息进上下文 |
| `"allowlist"` | `true` | 仅白名单群记录日志，且仅 @bot 进上下文 |

### 群消息 JSONL 日志

日志文件路径：`{groupLogDir}/{群号}.jsonl`

默认位置：`~/.openclaw/workspace/logs/milky-groups/`

每行一个 JSON 对象：

```json
{
  "ts": "2026-04-09T16:58:00.000Z",
  "sender_id": "123456789",
  "sender_name": "昵称",
  "message_seq": 12345,
  "text": "消息文本（图片显示为 [图片]）",
  "media": [{ "type": "image", "url": "https://..." }],
  "bot_mentioned": false
}
```

可通过 `milky-group-log` skill 读取群历史（`tail` / `grep` / `jq`），不占用 agent 上下文。

## Features

- Private & group messaging
- Media sending (image, voice, video)
- Message reactions (group)
- Message recall/unsend
- Reply with quote
- @mention support (`@123456789`, `@全体成员`)
- Friend request auto-accept (allowlist)
- Group invitation auto-accept
- Mention-only group mode with JSONL logging
- SSE and WebSocket event streaming

## License

MIT
