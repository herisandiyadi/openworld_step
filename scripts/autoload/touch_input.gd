extends Node
## Bridges on-screen controls (virtual joystick, look-drag area, jump button)
## into the same input actions / camera rotation used by keyboard+mouse, so
## Player never needs to know which input method is active.
##
## Desktop keyboard input keeps working normally through Godot's InputMap;
## this autoload only adds a touch layer on top for Android.

var move_axis: Vector2 = Vector2.ZERO
var sprint_held: bool = false

var _look_delta: Vector2 = Vector2.ZERO
var _jump_queued: bool = false

func set_move_axis(axis: Vector2) -> void:
	move_axis = axis.limit_length(1.0)

func add_look_delta(delta: Vector2) -> void:
	_look_delta += delta

func consume_look_delta() -> Vector2:
	var result := _look_delta
	_look_delta = Vector2.ZERO
	return result

func queue_jump() -> void:
	_jump_queued = true

func set_sprint(held: bool) -> void:
	sprint_held = held

func _process(_delta: float) -> void:
	_drive_action_from_axis("move_forward", -move_axis.y)
	_drive_action_from_axis("move_back", move_axis.y)
	_drive_action_from_axis("move_left", -move_axis.x)
	_drive_action_from_axis("move_right", move_axis.x)

	if _jump_queued:
		Input.action_press("jump")
		_jump_queued = false
	else:
		Input.action_release("jump")

	if sprint_held:
		Input.action_press("sprint")
	else:
		Input.action_release("sprint")

func _drive_action_from_axis(action: String, strength: float) -> void:
	if strength > 0.15:
		Input.action_press(action, clampf(strength, 0.0, 1.0))
	else:
		Input.action_release(action)
