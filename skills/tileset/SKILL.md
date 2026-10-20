---
name: tileset
description: Make game terrain tilesets with Voidless - side-view platformer ground sheets, top-down two-terrain auto-tile (wang) sheets, and 17-piece blob sheets - and slice them in an engine. Use when the user wants tiles, a tileset, terrain, ground, floors, paths or an auto-tiling map.
---

# Tilesets

`generate_image` with `type: tileset` and a `tilesetKind`. Tilesets always use GPT-Image (5
credits), whatever model is set.

| Kind | For | Prompt | Layout |
|---|---|---|---|
| `platformer` | side-view ground (default for `2d`) | the material: "mossy stone" | 3×3 sheet: corners, edges, middle |
| `wang` | top-down maps with two terrains (default for `top down`) | name both: "a cobblestone path in grass" | 4×5 auto-tile sheet, every edge matched |
| `blob17` | one terrain on transparent, top-down | "a pond of water" | 17 pieces |

- Top-down sheets have 256px tiles. `size` 32, 64 or 128 returns pixel-art tiles at that size.
- Below 512 the sheet is drawn at 512 and pixelated, so keep `size` and `colours` the same as the
  game's sprites.
- Make one tileset per terrain pair (grass↔path, grass↔water) in the same style and palette.

## Into Godot 4

1. Save the sheet into the project (download the PNG from the result link, or `get_image_data`).
2. TileMapLayer → new TileSet → set **Tile Size** to the tile size (e.g. 64×64 at `size` 64; 256×256
   for full-size top-down sheets) → drag the PNG into the TileSet panel and let it create tiles.
3. For `wang` sheets, add a Terrain Set (Match Corners and Sides) and paint the terrain peering bits
   once; then the terrain brush auto-tiles.
4. For pixel art, set Project Settings → Rendering → Textures → Default Texture Filter to
   **Nearest**.
