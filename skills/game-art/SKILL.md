---
name: game-art
description: Make game art with the Voidless MCP tools (sprites, characters, props, tilesets, UI, backdrops, animation, sound, music, 3D). Use when the user asks for game assets, sprites, pixel art, animations, sound effects or music for a game, or when a game you are building needs art.
---

# Game art with Voidless

The `voidless` MCP server (hosted at `https://mcp.voidless.dev/mcp`, sign in once) makes the art and
saves every result to the user's Voidless library at voidless.dev. Its tool descriptions list each
credit cost.

## Rules

- **Every generation spends the user's credits.** Make each request once and show the result. Don't
  re-roll for a better result; ask first and say what it costs. Re-run only when a tool returns an
  error.
- Before a large job (a whole character set, several animation passes, music), tell the user the
  total cost and wait for a yes.
- Library reads are free: `list_assets`, `get_asset`, `get_animation_presets`, tagging and
  `flip_left_side`.

## Picking settings

| Need | Settings |
|---|---|
| Pixel-art sprite | `size` 32, 64 or 128 (pixel look), `colours` 4–12, `palette` if the game has one |
| Clean / painted sprite | `size` 512, a `style` (cartoon, cel-shading, hand-drawn, anime, 3d-render…) |
| Platformer character | `type: character`, `dimension: 2d`, `facing: right`, `pose: idle` |
| Top-down character | `type: character`, `dimension: top down`, `facing: right` (side profiles turn best) |
| Prop / item / pickup | `type: object` |
| Backdrop | `type: artwork`, `aspect: 16:9` |
| Terrain | see the `tileset` skill |
| Button, panel, title | `type: ui` with `uiMode` graphic, title or text |

- A character that will be animated is drawn in the **idle** pose. `tpose` is only for rigging.
- Keep one `style`, `palette` and `size` across every asset in a game, so they look like one set.
- Use the default model (`flux2-klein`, 1 credit) unless the user names another.

## Workflows

- **A character that moves:** see the `character-set` skill. It covers turn → animate → mirror.
- **Into Godot:** see the `godot-import` skill (writes a SpriteFrames `.tres`).
- **Into HTML, Phaser or a sandbox:** `get_image_data` returns an image, or an animation as one
  sprite strip, as a data URI with a CSS snippet. Code sandboxes often can't download from
  voidless.dev, so use it instead of URLs there.
- **Sound and music:** see the `sound` skill (`generate_sfx`, `generate_music`).
- **3D:** `generate_3d_model`, then `rig_3d_model` (humanoids) and `animate_3d_model`.

## Tag as you go

`tag_asset` with the game's name (and roles like `player`, `enemy`, `tiles`) keeps the library
findable later: `list_assets` with `tag` filters on it.
