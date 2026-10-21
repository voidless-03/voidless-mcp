---
name: game-ready
description: Clean up sprites and short animations made outside Voidless so they are game-ready (background removed, pixel art on a real grid, stray pixels fixed, video to 16 frames) with the Voidless MCP tools clean_up_sprite and pixelate_image. Use when the user has art from another AI tool, an artist, a sprite pack or a screen recording and wants it usable in a game, asks to remove a background, "make it pixel art", fix messy AI pixel art, or turn a short clip into a sprite sheet.
---

# Make outside art game-ready

Two tools in the `voidless` MCP server (hosted at `https://mcp.voidless.dev/mcp`):

| Tool | Use it for | Saved to library | Cost |
|---|---|---|---|
| `clean_up_sprite` | Any image or 1-5 s video from anywhere: cut-out, stray pieces checked, pixel grid, clean-up; videos → 16 frames | Yes | 1 free run a day (10 on Voidless+), then 1 credit an image, 2 a video |
| `pixelate_image` | A quick pixel-art version of an image that is already clean (no background to remove) | No | 1 credit |

Art made with Voidless's own generators is cleaned already. Don't run these on it.

## Picking settings for clean_up_sprite

- **Pass the file as `url`** when it is online (a generated clip, a CDN link). Use `file` (base64) only
  for small local images; never paste a video as base64 if a link exists.
- `style: "pixel"` for pixel art at `size` 32, 64, 128 or 256, or 512 / 1024 for big pixel art
  (drawn on a real 4x grid). Match the size the game uses.
- `style: "smooth"` for painted, cel-shaded or 3D-render art: a clean cut-out at 512 or 1024.
- Video `motion`: `loop` for walks, runs, idles and anything that repeats (it finds the cleanest loop);
  `once` for attacks, jumps, deaths and casts (it keeps the whole move). The clip must be 1-5 seconds.
- `kind` is guessed from the URL's extension (.mp4, .webm, .mov = video). Set it when the link has no
  extension.

## Rules

- Run each file once and show the result. A run spends the user's free run or credits. Re-run only
  on an error, or when the user asks (for example a different size).
- Before cleaning many files, say how many runs it is and what it will cost past the free ones.
- The result is a library asset: `get_asset` shows its frames, `get_image_data` returns them as a
  data URI or sprite strip for code, and the `godot-import` skill turns them into SpriteFrames.
- If a clip comes back cut short or the loop looks wrong, it was probably the wrong `motion`. Say so
  and offer the other one rather than re-running on your own.
