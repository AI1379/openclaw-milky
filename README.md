# openclaw-milky

OpenClaw channel plugin for QQ via the [Milky](https://milky.ntqqrev.org/) protocol.

Uses [LagrangeV2.Milky](https://github.com/LagrangeDev/Lagrange.Core) as the protocol endpoint.

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
          "allowedUserIds": ["123456789"]
        }
      }
    }
  }
}
```

## Features

- Private & group messaging
- Media sending (image, voice, video)
- Message reactions (group)
- Message recall/unsend
- Reply with quote
- @mention support (`@123456789`, `@全体成员`)
- Friend request auto-accept (allowlist)
- Group invitation auto-accept
- SSE and WebSocket event streaming

## License

MIT
