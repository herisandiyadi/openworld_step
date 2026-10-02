extends Node3D
class_name WorldStreamer
## Loads and unloads terrain chunks (plus their decoration) around a tracked
## target so the world can be arbitrarily large without keeping everything in
## memory at once. This is the core mechanic that makes it "open world"
## instead of a single fixed-size level.

## Resolved from `target_path` in _ready(). A plain NodePath is used instead of
## an exported Node reference because the Node-reference form silently failed to
## resolve when set from the .tscn, leaving the streamer with no target and the
## world completely ungenerated.
var target: Node3D

@export var target_path: NodePath = ^"../Player"
@export var view_distance_in_chunks: int = 3
@export var noise_seed: int = 1337

var world_gen: WorldGen
var _factory: PropFactory
var _terrain_material: StandardMaterial3D
var _active_chunks: Dictionary = {}
var _last_center_coord: Vector2i = Vector2i(999999, 999999)

func _ready() -> void:
	world_gen = WorldGen.new(noise_seed)
	_factory = PropFactory.new()

	_terrain_material = StandardMaterial3D.new()
	# Colour comes from per-vertex colours baked in TerrainChunk; this flag is
	# what makes the material actually use them instead of a flat albedo.
	_terrain_material.vertex_color_use_as_albedo = true
	_terrain_material.roughness = 0.92

	target = get_node_or_null(target_path) as Node3D
	if target == null:
		push_error("WorldStreamer: target_path '%s' did not resolve; no terrain will stream." % target_path)
		return

	# Build the first ring synchronously so ground exists before anything is
	# placed on it or starts falling through it.
	_update_chunks(_world_to_chunk_coord(target.global_position))

func _process(_delta: float) -> void:
	if not target:
		return
	var center := _world_to_chunk_coord(target.global_position)
	if center != _last_center_coord:
		_update_chunks(center)

func _world_to_chunk_coord(world_pos: Vector3) -> Vector2i:
	return Vector2i(
		floori(world_pos.x / WorldGen.CHUNK_SIZE),
		floori(world_pos.z / WorldGen.CHUNK_SIZE)
	)

func _update_chunks(center: Vector2i) -> void:
	_last_center_coord = center
	var needed: Dictionary = {}

	for dz in range(-view_distance_in_chunks, view_distance_in_chunks + 1):
		for dx in range(-view_distance_in_chunks, view_distance_in_chunks + 1):
			var coord := Vector2i(center.x + dx, center.y + dz)
			needed[coord] = true
			if not _active_chunks.has(coord):
				_spawn_chunk(coord)

	for coord in _active_chunks.keys():
		if not needed.has(coord):
			_despawn_chunk(coord)

func _spawn_chunk(coord: Vector2i) -> void:
	var chunk := TerrainChunk.new()
	add_child(chunk)
	chunk.build(coord, world_gen, _terrain_material)

	var props := ChunkProps.new()
	# Props are parented to the chunk itself so despawning one frees the other.
	chunk.add_child(props)
	props.populate(coord, WorldGen.CHUNK_SIZE, world_gen, _factory)

	_active_chunks[coord] = chunk

func _despawn_chunk(coord: Vector2i) -> void:
	var chunk: Node = _active_chunks.get(coord)
	if chunk:
		chunk.queue_free()
	_active_chunks.erase(coord)

## Utility for spawning things (player, props) at the correct terrain height.
func height_at(world_x: float, world_z: float) -> float:
	if not world_gen:
		return 0.0
	return world_gen.height_at(world_x, world_z)