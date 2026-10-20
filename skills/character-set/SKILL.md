---
name: character-set
description: Build a complete animated game character with Voidless - one sprite, turned to 8 directions, with walk/run/attack/idle (top-down) or idle/run/jump/attack/hurt/death (platformer) clips that keep the same size and facing. Use when the user wants a player, enemy or NPC that moves, a character sprite sheet, 8-direction sprites, or a full animation set.
---

# Character set

The goal is one character with every clip the game needs, all the same size, feet on the same
line. Do the steps in order and **show the user each result before the next paid step**.

## 1. The sprite

`generate_image` with `type: character`, `pose: idle`, `facing: right`, and one style, palette and
size for the whole game (see `game-art`). Side profiles turn best. Show it and get a yes before
going on, since everything after this copies it.

Already have art? `upload_image` adds it (free), then continue from step 2.

## 2. Platformer (side view)

One call: `generate_animation_set` with `items: [{assetId}]` and `preset: platformer-character`.
That gives idle, run, jump, attack-1, death and hurt in one pass (100 credits; 200 for 1024px
sprites). The clips face right; the game faces left by flipping the sprite (`flip_h` in Godot,
`setFlipX` in Phaser).

Skip to step 4.

## 3. Top-down (8 directions)

1. `rotate_sprite` on the sprite (10 credits). This adds a `rotations - 8-way` frame. Its `tags`
   are the facings in order, e.g. `down,down-right,right,up-right,up,up-left,left,down-left`.
2. `get_asset` to read that frame's id and facings list.
3. `generate_animation_set` with one item per facing:
   `{assetId, frameIndex: <rotation frame id>, imageIndex: i}`, where `i` is the facing's position
   in the list, and a preset: `topdown-walk`, `topdown-run`, `topdown-dash` or `topdown-attack`
   (8 directions) or `topdown-idle` (4 cardinals only: down, right, up, left).
   - If the facings list has no `down` (the sprite was drawn facing the camera), add
     `{assetId, base: true}` as `down`.
   - The left-side clips are mirrored from the right side by default (`flipFacings`), so an
     8-direction set is one pass. Mention that one-sided details (a sword hand) swap on the left.
   - Set `holdFacing: true` for loops that must not drift (walks).
4. Each extra preset is another pass. Ask before adding run, dash and attack on top of walk.

## 4. Check and use it

- `get_asset` lists every clip by name (`walk-down`, `run-right`, `attack-1`…).
- Godot: run the `godot-import` skill. It downloads every clip and writes one SpriteFrames file.
- Web or HTML: `get_image_data` with the clip's frame id gives a sprite strip.
- `tag_asset` the character with the game's name and its role.

## Costs to quote up front

Sprite 1 credit (default model) · 8-way turn 10 · each animation pass 100 (200 at 1024px) ·
`flip_left_side` free. A top-down character with walk + attack is about 211 credits; a platformer
character with all six clips is about 101. The tool descriptions are the source of truth if these
differ.
