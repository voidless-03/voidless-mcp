---
name: sound
description: Make sound effects and music with Voidless (jump, coin, hit, footsteps, UI clicks, explosions; title, level, battle and menu loops) and wire them into a game, including Godot AudioStreamPlayer setup. Use when the user asks for sound effects, SFX, audio, music, a soundtrack or a loop.
---

# Sound effects and music

| Tool | Makes | Cost |
|---|---|---|
| `generate_sfx` | one short effect from a description | 5 credits |
| `generate_music` | a track, 30–120 s, with `bpm` and `keyScale` | 10 credits |

Both save to the user's Voidless library and return a `File:` URL to an MP3.

## Writing the prompt

- **Effects:** the sound itself, plainly: "a coin pickup chime", "a heavy sword hitting metal",
  "footsteps on gravel", "a soft menu click". One sound per call. Ask before making a whole batch
  and say the total (e.g. 8 effects = 40 credits).
- **Music:** genre, mood and instruments, 10–300 characters: "upbeat chiptune for a title screen,
  square leads and arpeggios". Match the game's art (pixel art suits chiptune; painted art suits
  orchestral or lo-fi). Set `duration` to the loop length you need; 60 s is a good default.
- For a set of tracks that belong together, keep `bpm` and `keyScale` the same across them.

## Into a project

Download each `File:` URL into the project (e.g. `audio/sfx/coin.mp3`, `audio/music/title.mp3`)
with `curl -L -o`. Name files after what they are, not the asset id.

**Godot 4:**

```gdscript
# One-shot effect
@onready var sfx: AudioStreamPlayer = $CoinSound   # stream = res://audio/sfx/coin.mp3
func collect() -> void:
	sfx.play()

# Looping music: turn on Loop in the MP3's Import dock, or in code:
func _ready() -> void:
	var music := AudioStreamPlayer.new()
	var stream: AudioStreamMP3 = load("res://audio/music/title.mp3")
	stream.loop = true
	music.stream = stream
	add_child(music)
	music.play()
```

Use `AudioStreamPlayer2D` for sounds that should pan and fade with distance.

**Web / Phaser:** `this.load.audio('coin', 'audio/sfx/coin.mp3')`, then
`this.sound.play('coin')`; for music, `this.sound.add('title', { loop: true }).play()`.
