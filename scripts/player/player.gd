extends CharacterBody3D
class_name Player
## Third-person open-world player controller.
##
## Movement is camera-relative: pressing "forward" moves the character toward
## wherever the camera is facing, which is the expected feel for open-world
## exploration.
##
## Input comes from two sources that are treated identically:
##   - desktop: WASD + mouse look (mouse captured)
##   - Android: on-screen joystick + drag-to-look (see TouchInput autoload)
##
## The visual body lives in a CharacterRig child which is yawed independently of
## this node, so the character turns to face where it walks while the camera
## keeps its own orientation.

@export var walk_speed: float = 5.0
@export var sprint_speed: float = 9.0
@export var jump_velocity: float = 8.0
@export var acceleration: float = 12.0
@export var air_control: float = 0.3
@export var mouse_sensitivity: float = 0.0025
@export var touch_look_sensitivity: float = 0.004
@export var turn_speed: float = 11.0

const PITCH_LIMIT: float = 1.2
## Starting camera pitch, in radians below the horizon. Kept here rather than
## baked into the SpringArm3D transform: tilting the arm itself swung the camera
## down into the terrain, whereas pitching the pivot orbits it up and behind the
## player, which is what a third-person view needs.
const START_PITCH: float = -0.30

@onready var camera_pivot: Node3D = $CameraPivot
@onready var rig: CharacterRig = $CharacterRig

var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 20.0)
var _camera_pitch: float = 0.0
var _uses_touch: bool = false
var _current_max_speed: float = 5.0

func _ready() -> void:
	_camera_pitch = START_PITCH
	camera_pivot.rotation.x = _camera_pitch
	_uses_touch = OS.has_feature("mobile") or DisplayServer.is_touchscreen_available()
	if not _uses_touch:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_rotate_view(event.relative * mouse_sensitivity)
	elif event.is_action_pressed("ui_cancel") and not _uses_touch:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func _rotate_view(amount: Vector2) -> void:
	rotate_y(-amount.x)
	_camera_pitch = clampf(_camera_pitch - amount.y, -PITCH_LIMIT, PITCH_LIMIT)
	camera_pivot.rotation.x = _camera_pitch

func _physics_process(delta: float) -> void:
	_apply_touch_look()
	_apply_vertical(delta)
	_apply_horizontal(delta)
	move_and_slide()
	_update_rig(delta)

func _apply_touch_look() -> void:
	var look := TouchInput.consume_look_delta()
	if look != Vector2.ZERO:
		_rotate_view(look * touch_look_sensitivity)

func _apply_vertical(delta: float) -> void:
	if is_on_floor():
		if Input.is_action_just_pressed("jump"):
			velocity.y = jump_velocity
	else:
		velocity.y -= _gravity * delta

func _apply_horizontal(delta: float) -> void:
	var input_dir := Vector2(
		Input.get_action_strength("move_right") - Input.get_action_strength("move_left"),
		Input.get_action_strength("move_back") - Input.get_action_strength("move_forward")
	)

	var move_dir := transform.basis * Vector3(input_dir.x, 0.0, input_dir.y)
	move_dir.y = 0.0
	if move_dir.length_squared() > 1.0:
		move_dir = move_dir.normalized()

	var target_speed := sprint_speed if Input.is_action_pressed("sprint") else walk_speed
	_current_max_speed = target_speed
	var target_velocity := move_dir * target_speed

	var accel := acceleration if is_on_floor() else acceleration * air_control
	var max_change := accel * delta
	velocity.x = move_toward(velocity.x, target_velocity.x, max_change)
	velocity.z = move_toward(velocity.z, target_velocity.z, max_change)

## Turns the visual body toward its travel direction and drives the walk cycle.
func _update_rig(delta: float) -> void:
	if rig == null:
		return

	var planar := Vector3(velocity.x, 0.0, velocity.z)
	var speed := planar.length()

	if speed > 0.35:
		# Target yaw is in this node local space, since the rig is a child.
		var desired := atan2(-planar.x, -planar.z) - rotation.y
		rig.rotation.y = lerp_angle(rig.rotation.y, desired, clampf(delta * turn_speed, 0.0, 1.0))

	rig.update_motion(speed, _current_max_speed, is_on_floor(), delta)