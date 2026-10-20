# Voidless MCP server

Generate game assets from any MCP client (claude.ai, ChatGPT, Claude Desktop, Claude Code, Cursor, VS Code, Windsurf and others): sprites, animations, tilesets, sound effects, music, video and 3D models, saved straight to your [Voidless](https://voidless.dev) library and shown right in the chat.

Two ways to connect: the **hosted connector** (paste a URL, sign in, nothing to install) or this **npm package** (runs locally with an API key). Setup guide: [voidless.dev/mcp](https://voidless.dev/mcp).

## Requirements

- A Voidless account on **Voidless+**
- For the npm package: Node.js 18 or newer and an API key (starts with `void_`), created at [voidless.dev/account](https://voidless.dev/account)

Every generation spends credits from your Voidless account. Tool descriptions list the cost tiers where they differ.

## Setup

### Hosted connector (no install)

Connector URL:

```
https://mcp.voidless.dev/mcp
```

- **Claude** (claude.ai and the Claude apps): **Settings → Connectors → Add custom connector**, name it Voidless and paste the URL.
- **ChatGPT** (web, paid plans): **Settings → Apps & Connectors → Advanced settings**, turn on **Developer mode**, then **Create**, paste the URL and choose **OAuth**.
- Any other MCP client that takes a remote server URL works the same way.

You'll be asked to sign in to Voidless and click **Allow**; no API key to copy. Results show inline in
hosts that support MCP Apps: images, every facing of a rotation, animations playing, and audio and video
players. To disconnect, revoke the "… connector" key under API keys on [voidless.dev/account](https://voidless.dev/account).

### Local server (npx)

For clients that run a local server, or to work with image files on your own disk.

Claude Desktop / Cursor / any client with a JSON config:

```json
{
  "mcpServers": {
    "voidless": {
      "command": "npx",
      "args": ["-y", "voidless-mcp"],
      "env": { "VOIDLESS_API_KEY": "void_..." }
    }
  }
}
```

Claude Code:

```sh
claude mcp add voidless -e VOIDLESS_API_KEY=void_... -- npx -y voidless-mcp
```

## Tools

**Your library** (free, read-only)

| Tool | What it does |
| --- | --- |
| `list_assets` | Your assets, newest first, filterable by type or tag |
| `get_asset` | One asset with every frame: animations, 8-way rotations, edits and parts, with the ids and image keys the other tools take |
| `get_animation_presets` | The animation-set presets and what each pass costs |

**Tagging** (free)

| Tool | What it does |
| --- | --- |
| `tag_asset` | Add, remove or replace an asset's tags |
| `tag_frame` | Add, remove or replace the tags on one animation, edit or part |

**Images**

| Tool | What it does |
| --- | --- |
| `generate_image` | Sprite, character, portrait, prop, tileset, UI piece or artwork in a chosen model, style, palette, size and perspective; artwork can be 16:9 for backdrops |
| `edit_image` | Change an image with an instruction; the edit is added as a new frame |
| `rotate_sprite` | An 8-way set (front, back, sides, diagonals) in one pass |
| `extract_parts` | Split a character into body parts for rigging |
| `upload_image` | Add an image you already have to your library |
| `pixelate_image` | Convert any image to pixel art |

**Animation**

| Tool | What it does |
| --- | --- |
| `animate_sprite` | One 16-frame clip from a description of the motion |
| `generate_animation_set` | Several clips in one job: a preset (platformer, top-down walk/run/dash/attack/idle) on one sprite, or one directional clip per facing of an 8-way set; the left side is mirrored from the right (`autoFlip` to mirror any right-only clips after the run) |
| `get_image_data` | An image, or an animation as one sprite strip, as a small data URI to paste into HTML (for sandboxes such as Claude's HTML artifacts that cannot load outside images), with a CSS snippet to play it |
| `flip_left_side` | Mirror the right-side animations into the left side (walk-right -> walk-left), free |

**Sound, video and 3D**

| Tool | What it does |
| --- | --- |
| `generate_sfx` / `generate_music` | Sound effect, or a music track with length, tempo and key |
| `generate_video` / `extend_video` | Short clip from a prompt and reference images, or continue one |
| `generate_3d_model` / `rig_3d_model` / `animate_3d_model` | 3D model, rig it, animate it |

Generation tools create new content in your library; none deletes or overwrites existing assets. Each tool's description lists its credit cost.

## Example prompts

- "Make a 64px pixel-art knight, side view, turn it into an 8-way set and give it a top-down walk in every direction."
- "Mirror my knight's right-facing animations into the left side."
- "Generate a top-down grass and dirt tileset in a gameboy palette."
- "Give me a coin pickup sound effect and a short chiptune loop for the title screen."
- "Create a low-poly treasure chest 3D model, rig it and animate it opening."

## Privacy Policy

This server sends your prompts, any images you pass in, and your API key to the Voidless API (api.voidless.dev) to run generations; results are stored in your Voidless account. It collects nothing else and keeps no local data. See the [Voidless Privacy Policy](https://voidless.dev/privacy-policy) for how Voidless collects, uses, stores, shares and retains data, and the [Terms of Service](https://voidless.dev/terms-of-service).

## Support

contact@voidless.dev · API docs: [voidless.dev/api-docs](https://voidless.dev/api-docs)
