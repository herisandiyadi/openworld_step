extends Control
class_name LookArea
## Full-area drag-to-look zone for Android (right two-thirds of the screen).
## Forwards drag deltas to the TouchInput autoload, which the Player consumes
## as camera rotation.

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_PASS

func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenDrag:
		TouchInput.add_look_delta(event.relative)
