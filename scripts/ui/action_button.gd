extends Control
class_name ActionButton
## Round, asset-free action button laid out like a MOBA action cluster.
##
## Drawn with _draw() so no textures are needed, and _has_point() is overridden
## so the touch area is a real circle instead of the square control bounds.
## That matters when buttons sit close together in an arc: square hitboxes would
## overlap and steal each other presses.

enum Kind {
	JUMP,   ## fires once per tap
	SPRINT, ## held for as long as the finger stays down
}

@export var kind: Kind = Kind.JUMP
@export var label: String = "JUMP"
@export var radius: float = 62.0
@export var accent: Color = Color(0.36, 0.72, 1.0)

var _pressed: bool = false
var _touch_index: int = -1

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = Vector2.ONE * radius * 2.0

func _center() -> Vector2:
	return size * 0.5

## Circular hit test keeps neighbouring buttons in the arc from overlapping.
func _has_point(point: Vector2) -> bool:
	return point.distance_to(_center()) <= radius

func _draw() -> void:
	var center := _center()
	var r := radius * (0.94 if _pressed else 1.0)

	draw_circle(center, r, Color(accent.r, accent.g, accent.b, 0.42 if _pressed else 0.24))
	draw_arc(center, r, 0.0, TAU, 48, Color(1, 1, 1, 0.78), 3.0, true)
	draw_arc(center, r * 0.86, 0.0, TAU, 40, Color(1, 1, 1, 0.22), 2.0, true)

	var font := ThemeDB.fallback_font
	var font_size := int(radius * 0.40)
	var text_size := font.get_string_size(label, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size)
	draw_string(
		font,
		center + Vector2(-text_size.x * 0.5, text_size.y * 0.30),
		label,
		HORIZONTAL_ALIGNMENT_CENTER,
		-1,
		font_size,
		Color(1, 1, 1, 0.95)
	)

## Presses are captured here because _gui_input only sees events inside the
## circle, which is exactly the behaviour wanted for starting a press.
func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch and event.pressed and _touch_index == -1:
		_touch_index = event.index
		_set_pressed(true)
		accept_event()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		# Mouse fallback so the layout can be exercised on desktop.
		if _touch_index == -1:
			_touch_index = -2
			_set_pressed(true)
			accept_event()

## Releases are watched globally: a finger that slides off the circle before
## lifting still has to end the press, otherwise SPRINT would latch on forever.
func _input(event: InputEvent) -> void:
	if not _pressed:
		return
	if event is InputEventScreenTouch and not event.pressed and event.index == _touch_index:
		_release()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT \
			and not event.pressed and _touch_index == -2:
		_release()

func _release() -> void:
	_touch_index = -1
	_set_pressed(false)

func _set_pressed(value: bool) -> void:
	if _pressed == value:
		return
	_pressed = value
	queue_redraw()

	match kind:
		Kind.JUMP:
			if value:
				TouchInput.queue_jump()
		Kind.SPRINT:
			TouchInput.set_sprint(value)