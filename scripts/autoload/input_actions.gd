extends Node
## Registers the input actions the prototype needs, in code.
##
## Defining them here instead of in project.godot keeps the action list
## reviewable as plain GDScript and avoids hand-writing Godot's binary-ish
## InputEvent serialization format into the .godot file.
##
## This autoload is ordered before TouchInput so every action exists before
## anything tries to press it.

const KEY_BINDINGS: Dictionary = {
	"move_forward": KEY_W,
	"move_back": KEY_S,
	"move_left": KEY_A,
	"move_right": KEY_D,
	"jump": KEY_SPACE,
	"sprint": KEY_SHIFT,
}

func _ready() -> void:
	for action_name in KEY_BINDINGS:
		_register(action_name, KEY_BINDINGS[action_name])

func _register(action_name: String, physical_keycode: Key) -> void:
	if not InputMap.has_action(action_name):
		InputMap.add_action(action_name, 0.2)

	for existing in InputMap.action_get_events(action_name):
		if existing is InputEventKey and existing.physical_keycode == physical_keycode:
			return

	var key_event := InputEventKey.new()
	key_event.physical_keycode = physical_keycode
	InputMap.action_add_event(action_name, key_event)
