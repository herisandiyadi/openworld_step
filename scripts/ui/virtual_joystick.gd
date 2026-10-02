extends Control
class_name TouchJoystick
## Asset-free on-screen joystick. Drawn with _draw() so the prototype has no
## texture dependencies.
##
## Reports a normalized Vector2 to the TouchInput autoload, where
## x = strafe (-1 left .. 1 right) and y = forward/back (-1 forward .. 1 back),
## matching the sign convention of the keyboard actions.

@export var knob_radius: float = 34.0
@export var base_radius: float = 96.0
@export var base_color: Color = Color(1, 1, 1, 0.16)
@export var outline_color: Color = Color(1, 1, 1, 0.38)
@export var knob_color: Color = Color(1, 1, 1, 0.55)

var _active_touch_index: int = -1
var _knob_offset: Vector2 = Vector2.ZERO

func _ready() -> void:
	custom_minimum_size = Vector2.ONE * base_radius * 2.0
	mouse_filter = Control.MOUSE_FILTER_STOP

func _center() -> Vector2:
	return size * 0.5

func _draw() -> void:
	var center := _center()
	draw_circle(center, base_radius, base_color)
	draw_arc(center, base_radius, 0.0, TAU, 48, outline_color, 2.0, true)
	draw_circle(center + _knob_offset, knob_radius, knob_color)

func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed and _active_touch_index == -1:
			_active_touch_index = event.index
			_update_knob(event.position)
			accept_event()
		elif not event.pressed and event.index == _active_touch_index:
			_release()
			accept_event()
	elif event is InputEventScreenDrag and event.index == _active_touch_index:
		_update_knob(event.position)
		accept_event()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		# Lets the joystick be tested with a mouse on desktop.
		if event.pressed:
			_active_touch_index = -2
			_update_knob(event.position)
		else:
			_release()
		accept_event()
	elif event is InputEventMouseMotion and _active_touch_index == -2:
		_update_knob(event.position)
		accept_event()

func _update_knob(local_position: Vector2) -> void:
	_knob_offset = (local_position - _center()).limit_length(base_radius)
	TouchInput.set_move_axis(_knob_offset / base_radius)
	queue_redraw()

func _release() -> void:
	_active_touch_index = -1
	_knob_offset = Vector2.ZERO
	TouchInput.set_move_axis(Vector2.ZERO)
	queue_redraw()
