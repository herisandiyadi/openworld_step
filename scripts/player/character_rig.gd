extends Node3D
class_name CharacterRig
## Low-poly humanoid built from primitives at runtime, with a procedural walk
## cycle. Used instead of an imported .glb so the prototype stays asset-free,
## while still reading clearly as a person rather than a floating capsule.
##
## Mesh density is deliberately higher than the bare minimum: capsules and
## spheres at ~10 radial segments read as visibly faceted at third-person
## camera distance, so limbs use 16 and the head 20. Boxes are avoided for
## body parts entirely - rounded primitives are what stop the silhouette
## looking blocky.
##
## The rig is intentionally simple: limb pivots are plain Node3D joints rotated
## by sine waves whose phase advances with ground speed. No AnimationPlayer is
## involved, so there is nothing to keep in sync with the controller state.

const SKIN := Color(0.80, 0.62, 0.48)
const SHIRT := Color(0.24, 0.45, 0.72)
const SHIRT_DARK := Color(0.19, 0.36, 0.60)
const PANTS := Color(0.24, 0.26, 0.33)
const SHOES := Color(0.15, 0.14, 0.14)
const HAIR := Color(0.17, 0.12, 0.09)

## Metres of travel per full two-step cycle. Drives stride phase so the feet
## appear to push against the ground instead of sliding.
const STRIDE_LENGTH: float = 2.1

var _hips: Node3D
var _torso: Node3D
var _head: Node3D
var _arm_l: Node3D
var _arm_r: Node3D
var _leg_l: Node3D
var _leg_r: Node3D

var _phase: float = 0.0
var _swing: float = 0.0
var _airborne_blend: float = 0.0

func _ready() -> void:
	build()

func build() -> void:
	var skin := _material(SKIN)
	var shirt := _material(SHIRT)
	var shirt_dark := _material(SHIRT_DARK)
	var pants := _material(PANTS)
	var shoes := _material(SHOES)
	var hair := _material(HAIR)

	_hips = Node3D.new()
	_hips.position = Vector3(0.0, 0.92, 0.0)
	add_child(_hips)

	_torso = Node3D.new()
	_hips.add_child(_torso)

	# Chest and waist as two tapered capsules gives a human taper instead of
	# one uniform tube.
	_add_capsule(_torso, shirt, 0.175, 0.34, Vector3(0.0, 0.46, 0.0))
	_add_capsule(_torso, shirt_dark, 0.150, 0.26, Vector3(0.0, 0.17, 0.0))
	# Rounded shoulder caps replace the old box slab.
	_add_sphere(_torso, shirt, 0.105, Vector3(-0.175, 0.575, 0.0))
	_add_sphere(_torso, shirt, 0.105, Vector3(0.175, 0.575, 0.0))
	_add_sphere(_torso, shirt, 0.135, Vector3(0.0, 0.565, 0.0))
	# Hip mass so the legs do not appear to dangle from a point.
	_add_sphere(_torso, pants, 0.155, Vector3(0.0, 0.02, 0.0))

	_head = Node3D.new()
	_head.position = Vector3(0.0, 0.70, 0.0)
	_torso.add_child(_head)
	_add_capsule(_head, skin, 0.050, 0.12, Vector3(0.0, -0.02, 0.0))
	# Skull slightly taller than wide, plus a hair shell offset back.
	var skull := _add_sphere(_head, skin, 0.118, Vector3(0.0, 0.135, 0.0))
	skull.scale = Vector3(1.0, 1.12, 1.04)
	var mane := _add_sphere(_head, hair, 0.121, Vector3(0.0, 0.158, 0.012))
	mane.scale = Vector3(1.0, 0.92, 1.0)
	# Nose, so which way the character faces is unmistakable at camera distance.
	var nose := _add_sphere(_head, skin, 0.031, Vector3(0.0, 0.116, -0.104))
	nose.scale = Vector3(0.82, 0.70, 1.0)

	_arm_l = _make_arm(shirt, skin, -1.0)
	_arm_r = _make_arm(shirt, skin, 1.0)
	_leg_l = _make_leg(pants, shoes, -1.0)
	_leg_r = _make_leg(pants, shoes, 1.0)

func _make_arm(sleeve: Material, skin: Material, side: float) -> Node3D:
	var pivot := Node3D.new()
	pivot.position = Vector3(0.185 * side, 0.545, 0.0)
	_torso.add_child(pivot)
	_add_capsule(pivot, sleeve, 0.058, 0.26, Vector3(0.0, -0.14, 0.0))
	_add_sphere(pivot, sleeve, 0.058, Vector3(0.0, -0.28, 0.0))
	_add_capsule(pivot, skin, 0.049, 0.24, Vector3(0.0, -0.41, 0.0))
	var hand := _add_sphere(pivot, skin, 0.060, Vector3(0.0, -0.555, 0.0))
	hand.scale = Vector3(0.85, 1.1, 1.0)
	return pivot

## Leg segment lengths are chosen so the sole lands exactly on y=0 in world
## space: hips sit at 0.92, and the foot sphere bottom (centre -0.869 minus its
## squashed half-height 0.051) works out to -0.920. Getting this wrong makes the
## character visibly hover above or sink into the terrain.
func _make_leg(trousers: Material, boot: Material, side: float) -> Node3D:
	var pivot := Node3D.new()
	pivot.position = Vector3(0.095 * side, 0.0, 0.0)
	_hips.add_child(pivot)
	_add_capsule(pivot, trousers, 0.079, 0.40, Vector3(0.0, -0.19, 0.0))
	_add_sphere(pivot, trousers, 0.076, Vector3(0.0, -0.40, 0.0))
	_add_capsule(pivot, trousers, 0.066, 0.40, Vector3(0.0, -0.62, 0.0))
	# Foot from a squashed, forward-shifted sphere: rounded, not a brick.
	# Toes point along -Z, which is Godot's forward and the direction the
	# controller actually moves the body. They used to point at +Z, which made
	# the character walk backwards and showed its face to the chase camera.
	var foot := _add_sphere(pivot, boot, 0.098, Vector3(0.0, -0.869, -0.048))
	foot.scale = Vector3(0.80, 0.52, 1.45)
	return pivot

## Called every physics frame by Player. `planar_speed` is horizontal speed in
## m/s, `max_speed` the current top speed (walk or sprint) used to normalise the
## animation intensity.
func update_motion(planar_speed: float, max_speed: float, on_floor: bool, delta: float) -> void:
	var intensity := 0.0
	if max_speed > 0.01:
		intensity = clampf(planar_speed / max_speed, 0.0, 1.0)

	# Phase tied to distance travelled keeps stride and speed consistent.
	_phase += (planar_speed / STRIDE_LENGTH) * TAU * delta
	_swing = lerpf(_swing, intensity, clampf(delta * 9.0, 0.0, 1.0))
	_airborne_blend = lerpf(_airborne_blend, 0.0 if on_floor else 1.0, clampf(delta * 8.0, 0.0, 1.0))

	var step := sin(_phase)
	var step_opposite := sin(_phase + PI)
	var leg_amp := deg_to_rad(38.0) * _swing
	var arm_amp := deg_to_rad(32.0) * _swing

	var tuck := deg_to_rad(28.0) * _airborne_blend
	var reach := deg_to_rad(42.0) * _airborne_blend

	_leg_l.rotation.x = step * leg_amp - tuck
	_leg_r.rotation.x = step_opposite * leg_amp - tuck
	# Arms counter-swing against the legs, as in a real gait.
	_arm_l.rotation.x = step_opposite * arm_amp - reach
	_arm_r.rotation.x = step * arm_amp - reach
	_arm_l.rotation.z = deg_to_rad(7.0) + arm_amp * 0.18
	_arm_r.rotation.z = -deg_to_rad(7.0) - arm_amp * 0.18

	# Vertical bob peaks twice per cycle; idle keeps a faint breathing motion.
	var bob := absf(sin(_phase)) * 0.055 * _swing
	var breathe := sin(Time.get_ticks_msec() * 0.0016) * 0.012 * (1.0 - _swing)
	_hips.position.y = 0.92 + bob + breathe - _airborne_blend * 0.04
	# Negative pitch leans the chest toward -Z, i.e. into the run. Positive
	# leaned it backwards.
	_torso.rotation.x = -deg_to_rad(5.0) * _swing - deg_to_rad(7.0) * _airborne_blend
	_torso.rotation.y = sin(_phase) * deg_to_rad(4.0) * _swing
	# Counter-tilt keeps the gaze level while the chest is pitched forward.
	_head.rotation.x = deg_to_rad(3.0) * _swing

func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.80
	return material

func _add_capsule(parent: Node3D, material: Material, radius: float, height: float, offset: Vector3) -> MeshInstance3D:
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	mesh.height = maxf(height, radius * 2.0 + 0.001)
	mesh.radial_segments = 16
	mesh.rings = 4
	return _attach(parent, mesh, material, offset)

func _add_sphere(parent: Node3D, material: Material, radius: float, offset: Vector3) -> MeshInstance3D:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 20
	mesh.rings = 10
	return _attach(parent, mesh, material, offset)

func _attach(parent: Node3D, mesh: Mesh, material: Material, offset: Vector3) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	instance.material_override = material
	instance.position = offset
	parent.add_child(instance)
	return instance