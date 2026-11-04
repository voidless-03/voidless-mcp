# Voidless MCP server

Generate game assets from any MCP client (claude.ai, ChatGPT, Claude Desktop, Claude Code, Cursor, VS Code, Windsurf and others): sprites, animations, tilesets, sound effects, music, video and 3D models, saved straight to your [Voidless](https://voidless.dev) library and shown right in the chat.

Two ways to connect: the **hosted connector** (paste a URL, sign in, nothing to install; recommended) or this **npm package** (runs locally with an API key). Setup guide: [voidless.dev/mcp](https://voidless.dev/mcp).

## Requirements

- For the hosted connector: a free Voidless account is enough
- For the npm package: Node.js 18 or newer and your own API key (starts with `void_`), created at [voidless.dev/account](https://voidless.dev/account). API keys are a **Voidless+** perk

Every generation spends credits from your Voidless account, at the same prices as the website, and your plan's rules apply as they do there. Tool descriptions list the cost tiers where they differ. The free game-dev tools (below) cost no credits.

## Setup

### Hosted connector (no install)

Connector URL:

```
https://mcp.voidless.dev/mcp
```

- **Claude** (claude.ai and the Claude apps): **Settings → Connectors → Add custom connector**, name it Voidless and paste the URL.
- **ChatGPT** (web, paid plans): **Settings → Apps & Connectors → Advanced settings**, turn on **Developer mode**, then **Create**, paste the URL and choose **OAuth**.
- **Claude Code**: `claude mcp add --transport http voidless https://mcp.voidless.dev/mcp`, then `/mcp` to sign in.
- **Cursor** and any other MCP client that takes a remote server URL work the same way.

You'll be asked to sign in to Voidless and click **Allow**; no API key to copy. Results show inline in
hosts that support MCP Apps: images, every facing of a rotation, animations playing, and audio and video
players. To disconnect, revoke the "… connector" key under API keys on [voidless.dev/account](https://voidless.dev/account).

### Local server (npx)

For clients that run a local server, or to work with image files on your own disk. Needs your own API key (Voidless+).

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

### Claude Code plugin

The hosted connector plus skills for character sets, tilesets and Godot import
([source](https://github.com/voidless-03/voidless-mcp)):

```
/plugin marketplace add voidless-03/voidless-mcp
/plugin install voidless@voidless
```

Or just the hosted connector, no key: `claude mcp add --transport http voidless https://mcp.voidless.dev/mcp`

## Tools

**Your library** (free, read-only)

| Tool | What it does |
| --- | --- |
| `list_assets` | Your assets, newest first, filterable by type or tag |
| `get_asset` | One asset with every frame: animations, 8-way rotations, edits and parts, with the ids and image keys the other tools take |
| `check_generation` | The result of a long generation (animation sets, video, 3D) that was still running when its tool returned. Free |
| `get_animation_presets` | The animation-set presets and what each clip costs |

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
| `make_normal_map` | A normal map for an image, an edit or every frame of an animation, for 2D lights in a game engine; free |
| `make_glow_map` | The light an edit added (lit windows, a night version's lamps) on its own, for an additive glow layer; free |
| `rotate_sprite` | An 8-way set (front, back, sides, diagonals) in one pass |
| `extract_parts` | Split a character into body parts for rigging |
| `upload_image` | Add an image you already have to your library |
| `pixelate_image` | Convert any image to pixel art (32 to 1024 px) |
| `clean_up_sprite` | Make a sprite or a 1-5 s animation from anywhere game-ready: background removed, pixel art on a real grid, stray pixels fixed; videos come back as 16 frames |

**Animation**

| Tool | What it does |
| --- | --- |
| `animate_sprite` | One 16-frame clip from a description of the motion |
| `generate_animation_set` | Several clips in one job, 15 credits each: a preset (platformer, top-down walk/run/dash/attack/idle) on one or more sprites, one directional clip per facing of an 8-way set (the left side mirrored from the right for free; `autoFlip` mirrors any right-only clips after the run), or your own list of actions. Loops end on their first frame |
| `get_image_data` | An image, or an animation as one sprite strip, as a small data URI to paste into HTML (for sandboxes such as Claude's HTML artifacts that cannot load outside images), with a CSS snippet to play it |
| `flip_left_side` | Mirror the right-side animations into the left side (walk-right -> walk-left), free |

**Sound, video and 3D**

| Tool | What it does |
| --- | --- |
| `generate_sfx` / `generate_music` | Sound effect, or a music track with length, tempo and key |
| `generate_video` / `extend_video` | Short clip from a prompt and reference images, or continue one |
| `generate_3d_model` / `rig_3d_model` / `animate_3d_model` | 3D model, rig it, animate it |
| `render_3d_sprites` | A 3D model's move (or the model standing) as 2D sprites: 8, 4, platformer, isometric or front views, 16 frames, 32-512 px; free |

**Free game-dev tools** (no credits)

The same tools as [voidless.dev/tools](https://voidless.dev/tools), for any image, not just your library. Inputs are image URLs (a `cdn.voidless.dev` link from `get_asset` or a saved result works), image keys from your library (`assets/…png`, as `get_asset` lists them), or base64/data URIs, PNG or GIF, up to 2048x2048, 256 frames and 32 MB per call. Results come back in the chat: images as PNG/GIF, the `.tres` and atlas `.json` as text.

Results can also be saved to your library (free, private, counts toward your storage), which gives them an asset id and `cdn.voidless.dev` URLs to pass to the next tool instead of base64 (for example `generate_vfx` → `palette_swap` → `add_outline` → `animate_sprite`). `generate_vfx` saves its effect by default (with its recipe, so it can be rendered again; `save: false` skips it); `palette_swap`, `add_outline`, `pack_sprite_sheet`, `slice_sprite_sheet` and `make_gif` save only when you pass `save: true`. They run on Voidless's server: the hosted connector serves them, and the npm package forwards them there with your key (so they need a connection).

| Tool | What it does |
| --- | --- |
| `slice_sprite_sheet` | Cut a sheet into frames by columns/rows or cell size, or auto-detect the grid; optional trim, empty cells skipped |
| `pack_sprite_sheet` | Pack frames into one sheet plus a frames-hash atlas JSON (Phaser, PixiJS); padding, grid columns, power-of-two |
| `export_godot_spriteframes` | A Godot 4 SpriteFrames `.tres` and the sheet PNG it references, from frames or a sheet, with named animations (fps, loop) |
| `make_gif` | Frames or a sheet to an animated GIF: fps, loop, nearest-neighbour scale, transparency kept |
| `palette_swap` | Swap colours (exact from→to pairs, or nearest), or quantize to a preset/custom palette with dithering; lists an image's colours |
| `add_outline` | Outline a transparent sprite: colour, thickness, outside or inside, 4- or 8-connected |

Generation tools create new content in your library; none deletes or overwrites existing assets. Each tool's description lists its credit cost.

## Example prompts

- "Make a 64px pixel-art knight, side view, turn it into an 8-way set and give it a top-down walk in every direction."
- "Mirror my knight's right-facing animations into the left side."
- "Generate a top-down grass and dirt tileset in a gameboy palette."
- "Give me a coin pickup sound effect and a short chiptune loop for the title screen."
- "Create a low-poly treasure chest 3D model, rig it and animate it opening."
- "Slice this sheet into frames, make a 2x GIF of it, and give me a Godot SpriteFrames with idle (frames 0-3) and walk (4-9)."

## Privacy Policy

This server sends your prompts, any images you pass in, and your API key to the Voidless API (api.voidless.dev) to run generations; results are stored in your Voidless account. The free tools send their inputs to mcp.voidless.dev, which processes them in memory and stores nothing unless a result is saved to your library (`generate_vfx` by default, the others with `save: true`), where it is kept like any other asset of yours; each call is logged against your account (tool, time taken, success, result size) for usage statistics. It collects nothing else and keeps no local data. See the [Voidless Privacy Policy](https://voidless.dev/privacy-policy) for how Voidless collects, uses, stores, shares and retains data, and the [Terms of Service](https://voidless.dev/terms-of-service).

## Support

contact@voidless.dev · API docs: [voidless.dev/api-docs](https://voidless.dev/api-docs)
