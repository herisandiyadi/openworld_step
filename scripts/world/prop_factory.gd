extends RefCounted
class_name PropFactory
## Builds all world decoration from primitives at runtime, so the prototype
## needs no imported 3D assets.
##
## Materials are created once and shared across every prop instance. Without
## this, each of the hundreds of streamed props would allocate its own material
## and the draw-call/state-change cost would show up immediately on mobile.

const TRUNK := Color(0.30, 0.22, 0.15)
const LEAF_DARK := Color(0.15, 0.32, 0.16)
const LEAF_LIGHT := Color(0.23, 0.43, 0.20)
const ROCK := Color(0.46, 0.45, 0.43)

## Building palette: desaturated and slightly varied, which reads far more like
## real concrete/brick than saturated primaries.
const FACADE := [
	Color(0.76, 0.74, 0.70), Color(0.66, 0.63, 0.60), Color(0.58, 0.55, 0.53),
	Color(0.72, 0.66, 0.58), Color(0.50, 0.47, 0.46), Color(0.63, 0.58, 0.55),
	Color(0.44, 0.43, 0.45), Color(0.69, 0.61, 0.54),
]
const ROOF_GREY := Color(0.24, 0.24, 0.26)
const TRIM := Color(0.33, 0.32, 0.31)
const GLASS := Color(0.29, 0.42, 0.52)
const GLASS_LIT := Color(0.98, 0.88, 0.62)
const METAL := Color(0.52, 0.53, 0.55)
const DOOR := Color(0.26, 0.20, 0.16)
const CURB := Color(0.62, 0.61, 0.59)
const ROAD_LINE := Color(0.86, 0.85, 0.79)
const PANE_HEIGHT: float = 1.45
const CAR_PAINT := [
	Color(0.62, 0.16, 0.14), Color(0.13, 0.22, 0.44), Color(0.85, 0.85, 0.86),
	Color(0.14, 0.14, 0.15), Color(0.32, 0.45, 0.33), Color(0.72, 0.68, 0.24),
]

var _materials: Dictionary = {}

func _init() -> void:
	_materials["trunk"] = _rough(TRUNK, 0.90)
	_materials["leaf_dark"] = _rough(LEAF_DARK, 0.88)
	_materials["leaf_light"] = _rough(LEAF_LIGHT, 0.88)
	_materials["rock"] = _rough(ROCK, 0.92)
	_materials["roof"] = _rough(ROOF_GREY, 0.85)
	_materials["trim"] = _rough(TRIM, 0.80)
	_materials["door"] = _rough(DOOR, 0.70)
	_materials["curb"] = _rough(CURB, 0.88)
	_materials["road_line"] = _rough(ROAD_LINE, 0.86)

	for i in FACADE.size():
		_materials["facade_%d" % i] = _rough(FACADE[i], 0.84)
	for i in CAR_PAINT.size():
		# Car paint is the one genuinely glossy surface in the scene.
		_materials["car_%d" % i] = _glossy(CAR_PAINT[i], 0.22, 0.45)

	# Windows read as glass through low roughness plus a touch of emission at
	# night-facing floors; fully reflective glass is too costly on mobile.
	_materials["glass"] = _glossy(GLASS, 0.12, 0.65)
	var lit := _glossy(GLASS_LIT, 0.30, 0.30)
	lit.emission_enabled = true
	lit.emission = GLASS_LIT
	lit.emission_energy_multiplier = 0.55
	_materials["glass_lit"] = lit

	_materials["metal"] = _glossy(METAL, 0.35, 0.80)

	var lamp := _rough(Color(0.99, 0.93, 0.74), 0.4)
	lamp.emission_enabled = true
	lamp.emission = Color(1.0, 0.92, 0.70)
	lamp.emission_energy_multiplier = 1.6
	_materials["lamp_glow"] = lamp

	_materials["tail_light"] = _emissive(Color(0.85, 0.12, 0.10), 0.9)
	_materials["head_light"] = _emissive(Color(0.95, 0.94, 0.85), 0.7)

func _rough(color: Color, roughness: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	return m

func _glossy(color: Color, roughness: float, specular: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	m.metallic = specular * 0.5
	m.metallic_specular = specular
	return m

func _emissive(color: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = 0.5
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	return m

func material(name: String) -> StandardMaterial3D:
	return _materials.get(name)

## ------------------------------------------------------------ buildings ----

## A city building sized to fill part of a block. `storeys` drives its height,
## so downtown towers and outskirt shops come from the same routine.
func make_building(rng: RandomNumberGenerator, storeys: int, footprint: Vector2) -> Node3D:
	var body := StaticBody3D.new()

	var storey_height := rng.randf_range(3.1, 3.6)
	var height := storey_height * storeys
	var facade: Material = _materials["facade_%d" % rng.randi_range(0, FACADE.size() - 1)]

	var shell := BoxMesh.new()
	shell.size = Vector3(footprint.x, height, footprint.y)
	_add(body, shell, facade, Vector3(0.0, height * 0.5, 0.0))

	# Ground floor gets a darker plinth: a cheap cue that reads as shopfronts.
	var plinth := BoxMesh.new()
	plinth.size = Vector3(footprint.x + 0.18, minf(storey_height * 0.92, height), footprint.y + 0.18)
	_add(body, plinth, _materials["trim"], Vector3(0.0, plinth.size.y * 0.5, 0.0))

	_add_windows(body, rng, footprint, storeys, storey_height, height)
	_add_roofline(body, rng, footprint, height)

	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(footprint.x, height, footprint.y)
	collision.shape = shape
	collision.position = Vector3(0.0, height * 0.5, 0.0)
	body.add_child(collision)

	return body

## Window grid on all four faces.
##
## Panes go through two MultiMeshInstance3D nodes per building (lit and unlit)
## rather than one MeshInstance3D per pane. Per-pane nodes dominated the scene:
## 38 buildings alone accounted for roughly 4,700 mesh instances, which does not
## scale once blocks are actually full. This keeps the same per-window detail at
## two draw calls per building.
func _add_windows(parent: Node3D, rng: RandomNumberGenerator, footprint: Vector2,
		storeys: int, storey_height: float, height: float) -> void:
	var lit_chance := rng.randf_range(0.10, 0.34)
	var lit: Array[Transform3D] = []
	var dark: Array[Transform3D] = []

	for axis in 2:
		var face_width: float = footprint.x if axis == 0 else footprint.y
		var offset: float = (footprint.y if axis == 0 else footprint.x) * 0.5 + 0.03
		var columns := maxi(1, int(face_width / 2.6))
		var pane_width: float = minf(1.5, face_width / (columns + 0.9))
		var rot_y: float = 0.0 if axis == 0 else PI * 0.5
		var basis := Basis.from_euler(Vector3(0.0, rot_y, 0.0)) * Basis.from_scale(
			Vector3(pane_width, 1.0, 1.0)
		)

		for storey in range(1, storeys):
			var y := storey * storey_height + storey_height * 0.5
			if y + PANE_HEIGHT * 0.5 > height:
				continue
			for column in columns:
				var t := (float(column) + 0.5) / float(columns)
				var along := lerpf(-face_width * 0.42, face_width * 0.42, t)
				for side in [1.0, -1.0]:
					var pos: Vector3
					if axis == 0:
						pos = Vector3(along, y, offset * side)
					else:
						pos = Vector3(offset * side, y, along)
					if rng.randf() < lit_chance:
						lit.append(Transform3D(basis, pos))
					else:
						dark.append(Transform3D(basis, pos))

	_add_panes(parent, _materials["glass_lit"], lit)
	_add_panes(parent, _materials["glass"], dark)

## One MultiMeshInstance3D holding every pane that shares a material.
func _add_panes(parent: Node3D, material: Material, transforms: Array[Transform3D]) -> void:
	if transforms.is_empty():
		return
	var mesh := BoxMesh.new()
	mesh.size = Vector3(1.0, PANE_HEIGHT, 0.08)
	parent.add_child(_batch(mesh, material, transforms))

## -------------------------------------------------------- road surface ----

## Road markings and kerbs.
##
## These cannot be painted into terrain vertex colours. Terrain vertices are
## VERT_SPACING (1 m) apart, so a 0.16 m painted line falls between samples and
## disappears entirely; the carriageway ends up a flat grey expanse that does
## not read as a road at all. Separate thin geometry, batched per chunk, is the
## only way to get markings at this terrain resolution.
##
## Instance meshes are 1 m long in Z and stretched by each transform's basis, so
## one mesh serves every dash and kerb length.
func make_road_lines(transforms: Array[Transform3D]) -> MultiMeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.16, 0.04, 1.0)
	return _batch(mesh, _materials["road_line"], transforms)

func make_kerbs(transforms: Array[Transform3D]) -> MultiMeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.32, 0.30, 1.0)
	return _batch(mesh, _materials["curb"], transforms)

func _batch(mesh: Mesh, material: Material, transforms: Array[Transform3D]) -> MultiMeshInstance3D:
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.mesh = mesh
	multimesh.instance_count = transforms.size()
	for i in transforms.size():
		multimesh.set_instance_transform(i, transforms[i])

	var instance := MultiMeshInstance3D.new()
	instance.multimesh = multimesh
	instance.material_override = material
	return instance
## Parapet plus the odd rooftop box, so the skyline is not a row of flat slabs.
func _add_roofline(parent: Node3D, rng: RandomNumberGenerator, footprint: Vector2, height: float) -> void:
	var parapet := BoxMesh.new()
	parapet.size = Vector3(footprint.x + 0.3, 0.55, footprint.y + 0.3)
	_add(parent, parapet, _materials["roof"], Vector3(0.0, height + 0.18, 0.0))

	if rng.randf() < 0.65:
		var box := BoxMesh.new()
		box.size = Vector3(
			footprint.x * rng.randf_range(0.18, 0.4),
			rng.randf_range(1.2, 2.8),
			footprint.y * rng.randf_range(0.18, 0.4)
		)
		_add(parent, box, _materials["trim"], Vector3(
			rng.randf_range(-footprint.x * 0.2, footprint.x * 0.2),
			height + box.size.y * 0.5,
			rng.randf_range(-footprint.y * 0.2, footprint.y * 0.2)
		))

	if rng.randf() < 0.35:
		var mast := _cylinder(0.06, 0.09, rng.randf_range(2.5, 5.0))
		_add(parent, mast, _materials["metal"], Vector3(0.0, height + mast.height * 0.5, 0.0))

## ---------------------------------------------------------- street props ----

func make_street_lamp(rng: RandomNumberGenerator) -> Node3D:
	var root := Node3D.new()
	var height := rng.randf_range(6.0, 7.2)
	_add(root, _cylinder(0.10, 0.14, height), _materials["metal"], Vector3(0.0, height * 0.5, 0.0))

	# Arm reaching over the roadway, with the luminaire at its end.
	var arm := _cylinder(0.07, 0.07, 1.5)
	var arm_inst := _add(root, arm, _materials["metal"], Vector3(0.62, height - 0.25, 0.0))
	arm_inst.rotation.z = PI * 0.5

	var head := BoxMesh.new()
	head.size = Vector3(0.62, 0.16, 0.34)
	_add(root, head, _materials["lamp_glow"], Vector3(1.28, height - 0.32, 0.0))

	# One real light per lamp is far too many for mobile: at a 5-chunk view
	# distance a 45% chance measured 65 live omni lights at once. The emissive
	# luminaire material carries the look, so only a small subset casts real
	# light, and those fade out with distance to bound the per-frame cost.
	if rng.randf() < 0.18:
		var light := OmniLight3D.new()
		light.light_color = Color(1.0, 0.90, 0.68)
		light.light_energy = 2.4
		light.omni_range = 13.0
		light.omni_attenuation = 1.6
		light.shadow_enabled = false
		light.distance_fade_enabled = true
		light.distance_fade_begin = 34.0
		light.distance_fade_length = 12.0
		light.position = Vector3(1.28, height - 0.55, 0.0)
		root.add_child(light)

	return root

func make_car(rng: RandomNumberGenerator) -> Node3D:
	var body := StaticBody3D.new()
	var paint: Material = _materials["car_%d" % rng.randi_range(0, CAR_PAINT.size() - 1)]

	var length := rng.randf_range(4.0, 4.8)
	var width := rng.randf_range(1.72, 1.92)

	var lower := BoxMesh.new()
	lower.size = Vector3(width, 0.62, length)
	_add(body, lower, paint, Vector3(0.0, 0.62, 0.0))

	# Cabin is shorter and inset, which gives a car silhouette rather than a box.
	var cabin := BoxMesh.new()
	cabin.size = Vector3(width * 0.88, 0.56, length * 0.52)
	_add(body, cabin, paint, Vector3(0.0, 1.18, -length * 0.04))

	var glazing := BoxMesh.new()
	glazing.size = Vector3(width * 0.80, 0.34, length * 0.30)
	_add(body, glazing, _materials["glass"], Vector3(0.0, 1.30, -length * 0.02))

	for side in [-1.0, 1.0]:
		for end in [-1.0, 1.0]:
			var wheel := _cylinder(0.32, 0.32, 0.22)
			var inst := _add(body, wheel, _materials["trim"],
				Vector3(side * width * 0.46, 0.32, end * length * 0.32))
			inst.rotation.z = PI * 0.5

	var tail := BoxMesh.new()
	tail.size = Vector3(width * 0.74, 0.14, 0.07)
	_add(body, tail, _materials["tail_light"], Vector3(0.0, 0.78, length * 0.5))
	var head := BoxMesh.new()
	head.size = Vector3(width * 0.74, 0.14, 0.07)
	_add(body, head, _materials["head_light"], Vector3(0.0, 0.78, -length * 0.5))

	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(width, 1.5, length)
	collision.shape = shape
	collision.position = Vector3(0.0, 0.75, 0.0)
	body.add_child(collision)

	return body

func make_bench(rng: RandomNumberGenerator) -> Node3D:
	var root := Node3D.new()
	var seat := BoxMesh.new()
	seat.size = Vector3(1.85, 0.10, 0.52)
	_add(root, seat, _materials["trunk"], Vector3(0.0, 0.46, 0.0))
	var back := BoxMesh.new()
	back.size = Vector3(1.85, 0.44, 0.09)
	_add(root, back, _materials["trunk"], Vector3(0.0, 0.70, -0.22))
	for side in [-1.0, 1.0]:
		var leg := BoxMesh.new()
		leg.size = Vector3(0.09, 0.46, 0.46)
		_add(root, leg, _materials["metal"], Vector3(side * 0.78, 0.23, 0.0))
	return root

func make_hydrant(_rng: RandomNumberGenerator) -> Node3D:
	var root := Node3D.new()
	var red := _emissive(Color(0.62, 0.13, 0.11), 0.0)
	_add(root, _cylinder(0.13, 0.16, 0.66), red, Vector3(0.0, 0.33, 0.0))
	_add(root, _sphere(0.14), red, Vector3(0.0, 0.70, 0.0))
	for side in [-1.0, 1.0]:
		var nozzle := _cylinder(0.05, 0.05, 0.20)
		var inst := _add(root, nozzle, red, Vector3(side * 0.16, 0.44, 0.0))
		inst.rotation.z = PI * 0.5
	return root

## Rubbish bin doubling as generic pavement clutter.
func make_bin(rng: RandomNumberGenerator) -> Node3D:
	var root := Node3D.new()
	var height := rng.randf_range(0.85, 1.0)
	_add(root, _cylinder(0.27, 0.23, height), _materials["metal"], Vector3(0.0, height * 0.5, 0.0))
	return root

## --------------------------------------------------------------- nature ----

func make_tree(rng: RandomNumberGenerator) -> Node3D:
	var root := Node3D.new()
	var height := rng.randf_range(4.0, 7.5)
	var trunk_radius := height * rng.randf_range(0.040, 0.058)

	_add(root, _cylinder(trunk_radius, trunk_radius * 1.4, height),
		_materials["trunk"], Vector3(0.0, height * 0.5, 0.0))

	var leaf: Material = _materials["leaf_dark"] if rng.randf() < 0.5 else _materials["leaf_light"]
	var layers := rng.randi_range(2, 3)
	var canopy_base := height * 0.60

	for i in layers:
		var t := float(i) / float(maxi(layers - 1, 1))
		var layer_radius := lerpf(height * 0.30, height * 0.15, t)
		var layer_height := height * rng.randf_range(0.26, 0.34)
		var y := canopy_base + height * 0.30 * t
		var mesh: Mesh = _cylinder(0.001, layer_radius, layer_height) if layers > 2 \
			else _sphere(layer_radius)
		_add(root, mesh, leaf, Vector3(0.0, y + layer_height * 0.5, 0.0))

	root.rotation.y = rng.randf_range(0.0, TAU)
	return root

func make_bush(rng: RandomNumberGenerator) -> Node3D:
	var root := Node3D.new()
	var leaf: Material = _materials["leaf_dark"] if rng.randf() < 0.5 else _materials["leaf_light"]
	for i in rng.randi_range(2, 3):
		var r := rng.randf_range(0.35, 0.7)
		_add(root, _sphere(r), leaf,
			Vector3(rng.randf_range(-0.5, 0.5), r * 0.55, rng.randf_range(-0.5, 0.5)))
	return root

func make_rock(rng: RandomNumberGenerator) -> Node3D:
	var root := Node3D.new()
	for i in rng.randi_range(1, 3):
		var size := Vector3(
			rng.randf_range(0.6, 1.9), rng.randf_range(0.5, 1.5), rng.randf_range(0.6, 1.9)
		)
		var mesh := BoxMesh.new()
		mesh.size = size
		var inst := _add(root, mesh, _materials["rock"], Vector3(
			rng.randf_range(-0.6, 0.6), size.y * 0.35, rng.randf_range(-0.6, 0.6)
		))
		inst.rotation = Vector3(
			rng.randf_range(-0.25, 0.25), rng.randf_range(0.0, TAU), rng.randf_range(-0.25, 0.25)
		)
	return root

## --------------------------------------------------------------- shared ----

func _add(parent: Node3D, mesh: Mesh, material: Material, offset: Vector3) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	instance.material_override = material
	instance.position = offset
	parent.add_child(instance)
	return instance

func _cylinder(top_radius: float, bottom_radius: float, height: float) -> CylinderMesh:
	var mesh := CylinderMesh.new()
	mesh.top_radius = top_radius
	mesh.bottom_radius = bottom_radius
	mesh.height = height
	mesh.radial_segments = 10
	mesh.rings = 1
	return mesh

func _sphere(radius: float) -> SphereMesh:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 12
	mesh.rings = 6
	return mesh