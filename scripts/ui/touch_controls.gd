extends CanvasLayer
class_name TouchControls
## Container for the on-screen controls. Hidden on desktop so mouse+keyboard
## testing is not obstructed by the overlay.

func _ready() -> void:
	visible = OS.has_feature("mobile") or DisplayServer.is_touchscreen_available()
