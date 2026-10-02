extends Node3D
class_name ChunkProps
## Decides what belongs in one chunk and instantiates it.
##
## Urban chunks get buildings set back from the street grid, plus lamps, parked
## cars and pavement clutter. Rural chunks fall back to trees and rocks. The
## split is driven by WorldGen.urban_at(), so the city fades into countryside
## rather than ending at a hard border.

const BUILDING_CELL: float = 8.0
## Below this a plot is not worth building on; it would read as a shed.
const MIN_FOOTPRINT: float = 4.2
const TREE_CELL: float = 5.0
const ROCK_CELL: float = 9.0

func populate(chunk_coord: Vector2i, chunk_size: float, world_gen: WorldGen, factory: PropFactory) -> void:
	_build_road_markings(chunk_coord, chunk_size, world_gen, factory)
	_scatter_buildings(chunk_coord, chunk_size, world_gen, factory)
	_scatter_street_furniture(chunk_coord, chunk_size, world_gen, factory)
	_scatter_cars(chunk_coord, chunk_size, world_gen, factory)
	_scatter_nature(chunk_coord, chunk_size, world_gen, factory)
	_scatter_rocks(chunk_coord, chunk_size, world_gen, factory)

## Centreline dashes and edge-of-carriageway kerb strips for every road cell
## in the chunk.
##
## Sampled on a 1 m grid, matching VERT_SPACING, so a mark never falls between
## two evaluations of is_road() and disappears. Runs of consecutive same-axis
## samples are merged into one stretched instance instead of one box per
## metre, so the per-chunk multimesh count scales with road length, not with
## chunk area.
const MARK_STEP: float = 1.0
const DASH_HALF_WIDTH: float = 1.0

func _build_road_markings(chunk_coord: Vector2i, chunk_size: float, world_gen: WorldGen, factory: PropFactory) -> void:
	var origin_x := chunk_coord.x * chunk_size
	var origin_z := chunk_coord.y * chunk_size
	var steps := int(chunk_size / MARK_STEP)

	var dashes: Array[Transform3D] = []
	var kerbs: Array[Transform3D] = []

	# Scan north-south strips (fixed local_x, varying local_z): finds roads that
	# run along Z and the kerbs bordering them.
	for sx in steps:
		var local_x := (float(sx) + 0.5) * MARK_STEP
		var world_x := origin_x + local_x
		_scan_line(world_gen, world_x, origin_z, steps, false, local_x, dashes, kerbs)

	# Scan east-west strips (fixed local_z, varying local_x): roads along X.
	for sz in steps:
		var local_z := (float(sz) + 0.5) * MARK_STEP
		var world_z := origin_z + local_z
		_scan_line(world_gen, origin_x, world_z, steps, true, local_z, dashes, kerbs)

	if not dashes.is_empty():
		add_child(factory.make_road_lines(dashes))
	if not kerbs.is_empty():
		add_child(factory.make_kerbs(kerbs))

## Walks one grid line (fixed cross-coordinate) and emits merged runs of
## centreline dash and kerb cells. long_x: true means the line varies
## world_x at a fixed world_z (an east-west scan); false varies world_z at a
## fixed world_x (north-south).
func _scan_line(world_gen: WorldGen, fixed_world_x: float, fixed_world_z: float, steps: int,
		along_x: bool, cross_local: float, dashes: Array[Transform3D], kerbs: Array[Transform3D]) -> void:
	var dash_run_start := -1
	var kerb_run_start := -1

	for s in steps + 1:
		var t := float(s) * MARK_STEP
		var world_x: float = fixed_world_x + t if along_x else fixed_world_x
		var world_z: float = fixed_world_z if along_x else fixed_world_z + t

		var on_dash := s < steps and world_gen.is_road(world_x, world_z) \
			and world_gen.road_distance(world_x, world_z) < DASH_HALF_WIDTH
		# Dashed rather than solid: skip every third metre of an otherwise
		# eligible run.
		if on_dash and int(floor(t)) % 3 == 2:
			on_dash = false
		if on_dash and dash_run_start == -1:
			dash_run_start = s
		elif not on_dash and dash_run_start != -1:
			_emit_run(dashes, along_x, cross_local, dash_run_start, s, 0.02, world_gen, fixed_world_x, fixed_world_z)
			dash_run_start = -1

		var on_kerb := s < steps and world_gen.urban_at(world_x, world_z) > 0.32 \
			and absf(world_gen.road_distance(world_x, world_z) - WorldGen.ROAD_HALF_WIDTH) < 0.5
		if on_kerb and kerb_run_start == -1:
			kerb_run_start = s
		elif not on_kerb and kerb_run_start != -1:
			_emit_run(kerbs, along_x, cross_local, kerb_run_start, s, 0.15, world_gen, fixed_world_x, fixed_world_z)
			kerb_run_start = -1

## Builds one stretched transform covering grid steps [start, end) along the
## scan direction, at the given fixed cross-coordinate (already chunk-local).
func _emit_run(out: Array[Transform3D], along_x: bool, cross_local: float, start: int, end: int,
		y_offset: float, world_gen: WorldGen, fixed_world_x: float, fixed_world_z: float) -> void:
	var run_len := float(end - start) * MARK_STEP
	var centre_t := (float(start) + float(end)) * 0.5 * MARK_STEP
	var mid_world_x: float = fixed_world_x + centre_t if along_x else fixed_world_x
	var mid_world_z: float = fixed_world_z if along_x else fixed_world_z + centre_t
	var height := world_gen.height_at(mid_world_x, mid_world_z) + y_offset

	# Mesh's long axis is local Z; rotate 90 degrees for a run along world X.
	var rot_y := 0.0 if not along_x else PI * 0.5
	# Right-multiply: the stretch must apply to the mesh's own long axis (local
	# Z). Basis.scaled() left-multiplies, which would stretch global Z and so
	# widen a rotated mark instead of lengthening it.
	var basis := Basis(Vector3.UP, rot_y) * Basis.from_scale(Vector3(1.0, 1.0, run_len))
	var pos := Vector3(centre_t, height, cross_local) if along_x else Vector3(cross_local, height, centre_t)
	out.append(Transform3D(basis, pos))
## Buildings fill the block interior behind the pavement.
##
## The footprint is shrunk to the room actually available rather than rejecting
## the plot when it would overhang the kerb. Rejecting was why whole blocks came
## out empty: on a 48 m street grid a 16 m candidate spacing put most plot
## centres 8 m from a centreline, inside the setback, so they could never build.
func _scatter_buildings(chunk_coord: Vector2i, chunk_size: float, world_gen: WorldGen, factory: PropFactory) -> void:
	var rng := world_gen.rng_for(chunk_coord, 4)
	var origin_x := chunk_coord.x * chunk_size
	var origin_z := chunk_coord.y * chunk_size
	var cells := int(chunk_size / BUILDING_CELL)

	for cz in cells:
		for cx in cells:
			var local_x := (cx + 0.5) * BUILDING_CELL
			var local_z := (cz + 0.5) * BUILDING_CELL
			var world_x := origin_x + local_x
			var world_z := origin_z + local_z

			if not world_gen.is_buildable(world_x, world_z):
				continue
			if world_gen.flatness_at(world_x, world_z) < 0.90:
				continue
			if rng.randf() > 0.88:
				continue

			# Half-extent the plot can occupy before it would cross the setback line.
			var room := world_gen.building_room_at(world_x, world_z)
			var span: float = minf(BUILDING_CELL * 0.94, room * 2.0)
			if span < MIN_FOOTPRINT:
				continue

			var footprint := Vector2(
				span * rng.randf_range(0.82, 1.0),
				span * rng.randf_range(0.82, 1.0)
			)

			var storeys := world_gen.target_storeys(world_x, world_z, rng)
			var building := factory.make_building(rng, storeys, footprint)
			building.position = Vector3(local_x, world_gen.height_at(world_x, world_z) - 0.25, local_z)
			# Square to the street grid so facades line up along the block edge.
			building.rotation.y = 0.0
			add_child(building)
## Lamps, benches, bins and hydrants placed along pavements.
func _scatter_street_furniture(chunk_coord: Vector2i, chunk_size: float, world_gen: WorldGen, factory: PropFactory) -> void:
	var rng := world_gen.rng_for(chunk_coord, 5)
	var origin_x := chunk_coord.x * chunk_size
	var origin_z := chunk_coord.y * chunk_size

	for i in 26:
		var local_x := rng.randf_range(0.0, chunk_size)
		var local_z := rng.randf_range(0.0, chunk_size)
		var world_x := origin_x + local_x
		var world_z := origin_z + local_z

		if not world_gen.is_pavement(world_x, world_z):
			continue

		var height := world_gen.height_at(world_x, world_z)
		var roll := rng.randf()
		var prop: Node3D
		if roll < 0.34:
			prop = factory.make_street_lamp(rng)
			# Turn the lamp arm toward the nearer roadway.
			prop.rotation.y = _road_facing_angle(world_gen, world_x, world_z)
		elif roll < 0.55:
			prop = factory.make_bin(rng)
		elif roll < 0.78:
			prop = factory.make_bench(rng)
			prop.rotation.y = _road_facing_angle(world_gen, world_x, world_z)
		else:
			prop = factory.make_hydrant(rng)

		prop.position = Vector3(local_x, height, local_z)
		add_child(prop)

## Which way is the street? Compares road distance either side on both axes.
func _road_facing_angle(world_gen: WorldGen, world_x: float, world_z: float) -> float:
	var step := 2.0
	var dx := world_gen.road_distance(world_x + step, world_z) - world_gen.road_distance(world_x - step, world_z)
	var dz := world_gen.road_distance(world_x, world_z + step) - world_gen.road_distance(world_x, world_z - step)
	return atan2(-dx, -dz)

## Cars parked along the kerb, aligned with the road direction.
func _scatter_cars(chunk_coord: Vector2i, chunk_size: float, world_gen: WorldGen, factory: PropFactory) -> void:
	var rng := world_gen.rng_for(chunk_coord, 6)
	var origin_x := chunk_coord.x * chunk_size
	var origin_z := chunk_coord.y * chunk_size

	for i in 14:
		var local_x := rng.randf_range(0.0, chunk_size)
		var local_z := rng.randf_range(0.0, chunk_size)
		var world_x := origin_x + local_x
		var world_z := origin_z + local_z

		if world_gen.urban_at(world_x, world_z) < 0.4:
			continue
		# Park in the outer part of the carriageway, not the middle of the road.
		var d := world_gen.road_distance(world_x, world_z)
		if d < WorldGen.ROAD_HALF_WIDTH * 0.55 or d > WorldGen.ROAD_HALF_WIDTH - 0.6:
			continue
		if rng.randf() > 0.5:
			continue

		var car := factory.make_car(rng)
		car.position = Vector3(local_x, world_gen.height_at(world_x, world_z), local_z)
		# Align lengthwise with the street: roads run along whichever axis has
		# the larger distance gradient.
		var step := 2.0
		var gx := absf(world_gen.road_distance(world_x + step, world_z) - world_gen.road_distance(world_x - step, world_z))
		var gz := absf(world_gen.road_distance(world_x, world_z + step) - world_gen.road_distance(world_x, world_z - step))
		car.rotation.y = 0.0 if gx > gz else PI * 0.5
		add_child(car)

## Trees line the pavements in town and cluster into woods outside it.
func _scatter_nature(chunk_coord: Vector2i, chunk_size: float, world_gen: WorldGen, factory: PropFactory) -> void:
	var rng := world_gen.rng_for(chunk_coord, 1)
	var origin_x := chunk_coord.x * chunk_size
	var origin_z := chunk_coord.y * chunk_size
	var cells := int(chunk_size / TREE_CELL)

	for cz in cells:
		for cx in cells:
			var local_x := (cx + rng.randf_range(0.15, 0.85)) * TREE_CELL
			var local_z := (cz + rng.randf_range(0.15, 0.85)) * TREE_CELL
			var world_x := origin_x + local_x
			var world_z := origin_z + local_z

			var urban := world_gen.urban_at(world_x, world_z)
			var chance: float
			if urban > 0.45:
				# Street trees and park planting only; never on the roadway.
				if world_gen.is_road(world_x, world_z):
					continue
				chance = 0.34 if world_gen.is_plaza(world_x, world_z) else 0.12
			else:
				chance = world_gen.forest_density_at(world_x, world_z) * 0.85

			if rng.randf() > chance:
				continue
			if world_gen.flatness_at(world_x, world_z) < 0.55:
				continue

			var prop: Node3D = factory.make_bush(rng) if rng.randf() < 0.18 else factory.make_tree(rng)
			prop.position = Vector3(local_x, world_gen.height_at(world_x, world_z), local_z)
			prop.scale = Vector3.ONE * rng.randf_range(0.85, 1.25)
			add_child(prop)

func _scatter_rocks(chunk_coord: Vector2i, chunk_size: float, world_gen: WorldGen, factory: PropFactory) -> void:
	var rng := world_gen.rng_for(chunk_coord, 2)
	var origin_x := chunk_coord.x * chunk_size
	var origin_z := chunk_coord.y * chunk_size
	var cells := int(chunk_size / ROCK_CELL)

	for cz in cells:
		for cx in cells:
			if rng.randf() > 0.35:
				continue

			var local_x := (cx + rng.randf_range(0.2, 0.8)) * ROCK_CELL
			var local_z := (cz + rng.randf_range(0.2, 0.8)) * ROCK_CELL
			var world_x := origin_x + local_x
			var world_z := origin_z + local_z

			# Rocks are a wilderness feature; town keeps its ground tidy.
			if world_gen.urban_at(world_x, world_z) > 0.35:
				continue

			var rock := factory.make_rock(rng)
			rock.position = Vector3(local_x, world_gen.height_at(world_x, world_z), local_z)
			rock.scale = Vector3.ONE * rng.randf_range(0.7, 1.6)
			add_child(rock)