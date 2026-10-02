extends Control
class_name Minimap
## Top-right radar showing the street grid around the player.
##
## The map is rasterised into a small Image and drawn as a single textured rect,
## rather than issuing one draw_rect per cell. At 76x76 cells a per-cell
## approach would mean ~5800 draw calls every redraw, which is not affordable on
## mobile; this way it is one.
##
## The raster is only rebuilt when the player has actually moved far enough to
## change the picture, so standing still costs nothing.
##
## Note on buildings: exact building positions come from per-chunk RNG at spawn
## time, so the radar cannot know them without generating every chunk. It shades
## *buildable* land instead, which matches the real block layout closely enough
## to navigate by.

@export var streamer_path: NodePath = ^"../../WorldStreamer"
@export var player_path: NodePath = ^"../../Player"

## Width of the area covered by the radar, in world metres.
@export var world_span: float = 190.0
## Raster resolution. Kept low deliberately: it is scaled up when drawn.
@export var resolution: int = 76
## Rebuild the raster once the player has moved this far since the last one.
@export var refresh_distance: float = 5.0

const COL_ROAD := Color(0.20, 0.21, 0.23)
const COL_PAVEMENT := Color(0.46, 0.46, 0.45)
const COL_BUILDING := Color(0.55, 0.56, 0.60)
const COL_PLAZA := Color(0.26, 0.45, 0.24)
const COL_GRASS := Color(0.22, 0.34, 0.20)
const COL_WILD := Color(0.17, 0.27, 0.17)

var _streamer: WorldStreamer
var _player: Node3D
var _texture: ImageTexture
var _image: Image
var _last_origin: Vector2 = Vector2(INF, INF)

func _ready() -> void:
	_streamer = get_node_or_null(streamer_path) as WorldStreamer
	_player = get_node_or_null(player_path) as Node3D
	if _streamer == null or _player == null:
		push_error("Minimap: could not resolve streamer_path or player_path; radar disabled.")
		hide()
		return

	_image = Image.create(resolution, resolution, false, Image.FORMAT_RGB8)
	_texture = ImageTexture.create_from_image(_image)

func _process(_delta: float) -> void:
	if _streamer == null or _player == null or _streamer.world_gen == null:
		return

	var here := Vector2(_player.global_position.x, _player.global_position.z)
	if _last_origin.distance_to(here) >= refresh_distance:
		_rasterise(here)
		_last_origin = here
	# The heading marker turns every frame even when the raster is unchanged.
	queue_redraw()

func _rasterise(centre: Vector2) -> void:
	var gen := _streamer.world_gen
	var step := world_span / float(resolution)
	var half := world_span * 0.5

	for py in resolution:
		# Screen up is north, which is -Z in world space.
		var world_z := centre.y - half + py * step
		for px in resolution:
			var world_x := centre.x - half + px * step
			_image.set_pixel(px, py, _sample_colour(gen, world_x, world_z))

	_texture.update(_image)

func _sample_colour(gen: WorldGen, world_x: float, world_z: float) -> Color:
	var urban := gen.urban_at(world_x, world_z)

	if urban > 0.32:
		if gen.is_road(world_x, world_z):
			return COL_ROAD
		if gen.is_pavement(world_x, world_z):
			return COL_PAVEMENT
		if gen.is_plaza(world_x, world_z):
			return COL_PLAZA
		if gen.is_buildable(world_x, world_z):
			return COL_BUILDING
		return COL_GRASS

	# Outside town, shade by how wooded it is so the countryside still reads.
	return COL_GRASS.lerp(COL_WILD, gen.forest_density_at(world_x, world_z))

func _draw() -> void:
	var radius := minf(size.x, size.y) * 0.5
	var centre := size * 0.5

	# Backing plate, so the radar stays legible over a bright sky.
	draw_circle(centre, radius, Color(0.05, 0.06, 0.07, 0.72))

	if _texture != null:
		# Clip the square raster to the radar circle.
		var points := PackedVector2Array()
		var uvs := PackedVector2Array()
		var segments := 44
		for i in segments:
			var a := TAU * float(i) / float(segments)
			var offset := Vector2(cos(a), sin(a)) * radius
			points.append(centre + offset)
			# Raster is axis-aligned north-up, so UVs follow the same offset.
			uvs.append(Vector2(0.5, 0.5) + offset / (radius * 2.0))
		draw_colored_polygon(points, Color(1, 1, 1, 0.92), uvs, _texture)

	# Range rings give a sense of scale.
	draw_arc(centre, radius * 0.5, 0.0, TAU, 32, Color(1, 1, 1, 0.13), 1.0, true)
	draw_arc(centre, radius, 0.0, TAU, 48, Color(1, 1, 1, 0.55), 2.5, true)

	_draw_north_marker(centre, radius)
	_draw_player_marker(centre, radius)

func _draw_north_marker(centre: Vector2, radius: float) -> void:
	var font := ThemeDB.fallback_font
	var font_size := int(radius * 0.22)
	var label := "N"
	var text_size := font.get_string_size(label, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size)
	draw_string(
		font,
		centre + Vector2(-text_size.x * 0.5, -radius + text_size.y * 0.95),
		label, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size,
		Color(1, 1, 1, 0.75)
	)

## Arrow at the centre pointing where the player faces. The map itself stays
## north-up, which keeps street names/orientation stable while moving.
func _draw_player_marker(centre: Vector2, radius: float) -> void:
	var heading := 0.0
	if _player != null:
		# Player forward is -Z; convert to a screen-space angle with +Y downward.
		var forward := -_player.global_transform.basis.z
		heading = atan2(forward.x, -forward.z)

	var tip := radius * 0.17
	var tail := radius * 0.11
	var arrow := PackedVector2Array([
		centre + Vector2(sin(heading), -cos(heading)) * tip,
		centre + Vector2(sin(heading + 2.4), -cos(heading + 2.4)) * tail,
		centre + Vector2(sin(heading - 2.4), -cos(heading - 2.4)) * tail,
	])
	draw_colored_polygon(arrow, Color(0.30, 0.85, 1.0, 0.98))
	draw_polyline(
		PackedVector2Array([arrow[0], arrow[1], arrow[2], arrow[0]]),
		Color(1, 1, 1, 0.85), 1.5, true
	)