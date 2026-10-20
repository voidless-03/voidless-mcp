---
name: godot-import
description: Import a Voidless sprite, 8-way turn or animation set into a Godot 4 project as a SpriteFrames resource for AnimatedSprite2D, with every clip as a named animation. Use when the user wants Voidless art in Godot, an AnimatedSprite2D set up from a Voidless asset, or a character wired to play walk/idle/attack animations in Godot.
---

# Import into Godot 4

`scripts/voidless-godot.mjs` (Node 18+, no dependencies) downloads every clip of one asset into
the project and writes a SpriteFrames `.tres`:

```
res://art/<name>/<clip>/00.png, 01.png, …
res://art/<name>/<name>.tres      ← one animation per clip, plus idle_<facing> for each turn image
```

## Steps

1. Find the asset id: from the result that made it, or `list_assets`.
2. Run it from the project root (the folder with `project.godot`):

   ```sh
   VOIDLESS_API_KEY=void_... node "${CLAUDE_PLUGIN_ROOT}/skills/godot-import/scripts/voidless-godot.mjs" \
     --asset 115918 --project . [--dir art/knight] [--name knight] [--fps 12] [--only walk-right,idle]
   ```

   - `VOIDLESS_API_KEY`: a `void_…` key the user creates at https://voidless.dev/account. If it isn't
     set, ask the user to export it in their shell. **Never write the key into a file or the repo.**
   - No key? Write the asset as JSON (`{ "id", "prompt", "file", "meta_data": { "frames": [
     { "type": "animation", "name": "walk-down", "images": ["<image key or URL>", …] } ] } }`) and pass
     `--from-json asset.json`. This only works if you can see every image key; `get_asset` shortens
     clips longer than 8 frames, so the key is the reliable route.
   - `--dry-run` prints the clips without downloading.
3. Clips whose names contain attack, death, hurt, jump, dash, cast, shoot, punch or kick play once;
   everything else loops. Change `loop` in the editor if a clip needs otherwise.
4. In the scene: `AnimatedSprite2D` → Sprite Frames → Load the `.tres`. Open the Godot editor (or run
   `godot --headless --import`) once so it imports the new PNGs.
5. Pixel art: Project Settings → Rendering → Textures → Default Texture Filter → **Nearest**.

## Playing 8-direction clips

Clip names are `<action>_<facing>` with facings `down, down_right, right, up_right, up, up_left,
left, down_left`. A matching player script:

```gdscript
extends CharacterBody2D

@export var speed := 120.0
@onready var sprite: AnimatedSprite2D = $AnimatedSprite2D
var facing := "down"

const FACINGS := ["right", "down_right", "down", "down_left", "left", "up_left", "up", "up_right"]

func _physics_process(_delta: float) -> void:
	var dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	velocity = dir * speed
	move_and_slide()
	if dir != Vector2.ZERO:
		facing = FACINGS[wrapi(roundi(dir.angle() / (PI / 4)), 0, 8)]
	var anim := ("walk_" if dir != Vector2.ZERO else "idle_") + facing
	if sprite.sprite_frames.has_animation(anim) and sprite.animation != anim:
		sprite.play(anim)
```

For a platformer set (`idle`, `run`, `jump`, `attack_1`, `hurt`, `death`, all facing right),
play by name and set `sprite.flip_h = velocity.x < 0` to face left.
