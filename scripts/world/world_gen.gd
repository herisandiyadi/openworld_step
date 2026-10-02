extends RefCounted
class_name WorldGen
## Single source of truth for everything procedural about the world: terrain
## height, surface normals, ground colouring, the street grid, and the
## deterministic random streams used to place props.
##
## Every query is a pure function of world coordinates plus the world seed, so
## a chunk that gets unloaded and reloaded later regenerates identically. That
## property is what keeps streaming from visibly rearranging the world.

const CHUNK_SIZE: float = 32.0
## Vertex spacing is deliberately 1.0 so terrain collision can use
## HeightMapShape3D, which is far cheaper than a trimesh on mobile.
const VERTS_PER_SIDE: int = 33
const VERT_SPACING: float = 1.0

## Street layout. Roads run along every line where x or z is a multiple of
## BLOCK_PITCH, which gives a regular city grid with square blocks between them.
const BLOCK_PITCH: float = 48.0
const ROAD_HALF_WIDTH: float = 6.5
const SIDEWALK_WIDTH: float = 3.0
## Distance from a road centreline beyond which a building may stand.
const BUILDING_SETBACK: float = ROAD_HALF_WIDTH + SIDEWALK_WIDTH + 0.4

## The city is centred on the spawn point so the player starts downtown, then
## thins out into countryside past CITY_RADIUS.
const CITY_RADIUS: float = 300.0
const CITY_FALLOFF: float = 170.0

var seed: int = 1337
var height_scale: float = 22.0

var _terrain: FastNoiseLite
var _detail: FastNoiseLite
var _forest: FastNoiseLite
var _urban: FastNoiseLite
var _plaza: FastNoiseLite

func _init(world_seed: int = 1337) -> void:
	seed = world_seed

	_terrain = FastNoiseLite.new()
	_terrain.seed = seed
	_terrain.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_terrain.frequency = 0.008
	_terrain.fractal_type = FastNoiseLite.FRACTAL_FBM
	_terrain.fractal_octaves = 4
	_terrain.fractal_lacunarity = 2.0
	_terrain.fractal_gain = 0.5

	_detail = FastNoiseLite.new()
	_detail.seed = seed + 91
	_detail.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_detail.frequency = 0.06

	_forest = FastNoiseLite.new()
	_forest.seed = seed + 337
	_forest.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_forest.frequency = 0.004

	## Breaks the city edge into an organic shape instead of a perfect circle.
	_urban = FastNoiseLite.new()
	_urban.seed = seed + 751
	_urban.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_urban.frequency = 0.0028

	## Occasionally clears a block so downtown gets parks and plazas.
	_plaza = FastNoiseLite.new()
	_plaza.seed = seed + 1093
	_plaza.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_plaza.frequency = 0.012

## ------------------------------------------------------------------ city ----

## 1.0 deep downtown, 0.0 out in open country.
func urban_at(world_x: float, world_z: float) -> float:
	var distance := sqrt(world_x * world_x + world_z * world_z)
	var radial := clampf(
		inverse_lerp(CITY_RADIUS + CITY_FALLOFF, CITY_RADIUS - CITY_FALLOFF, distance),
		0.0, 1.0
	)
	var wobble := _urban.get_noise_2d(world_x, world_z) * 0.5 + 0.5
	return clampf(radial * lerpf(0.72, 1.18, wobble), 0.0, 1.0)

## Distance in metres to the nearest road centreline of the grid.
func road_distance(world_x: float, world_z: float) -> float:
	var half := BLOCK_PITCH * 0.5
	var dx := absf(fposmod(world_x + half, BLOCK_PITCH) - half)
	var dz := absf(fposmod(world_z + half, BLOCK_PITCH) - half)
	return minf(dx, dz)

func is_road(world_x: float, world_z: float) -> bool:
	return urban_at(world_x, world_z) > 0.32 and road_distance(world_x, world_z) < ROAD_HALF_WIDTH

func is_pavement(world_x: float, world_z: float) -> bool:
	if urban_at(world_x, world_z) <= 0.32:
		return false
	var d := road_distance(world_x, world_z)
	return d >= ROAD_HALF_WIDTH and d < ROAD_HALF_WIDTH + SIDEWALK_WIDTH

## True where a building is allowed to stand: urban, and clear of the street.
func is_buildable(world_x: float, world_z: float) -> bool:
	if urban_at(world_x, world_z) < 0.45:
		return false
	if road_distance(world_x, world_z) < BUILDING_SETBACK:
		return false
	return not is_plaza(world_x, world_z)

## Half-extent (metres from centre to edge) a building plot at this point can
## occupy before its footprint would cross the kerb setback. Used to shrink a
## building to fit instead of rejecting the whole plot outright.
func building_room_at(world_x: float, world_z: float) -> float:
	var half := BLOCK_PITCH * 0.5
	var dx := absf(fposmod(world_x + half, BLOCK_PITCH) - half)
	var dz := absf(fposmod(world_z + half, BLOCK_PITCH) - half)
	return maxf(0.0, minf(dx, dz) - BUILDING_SETBACK)
## Blocks that stay open as a park/plaza instead of being built on.
func is_plaza(world_x: float, world_z: float) -> bool:
	var block := Vector2i(floori(world_x / BLOCK_PITCH), floori(world_z / BLOCK_PITCH))
	var n := _plaza.get_noise_2d(block.x * 100.0, block.y * 100.0)
	return n > 0.42

## Rough storey count target, so downtown is tall and the outskirts are low.
func target_storeys(world_x: float, world_z: float, rng: RandomNumberGenerator) -> int:
	var urban := urban_at(world_x, world_z)
	var distance := sqrt(world_x * world_x + world_z * world_z)
	var core := clampf(inverse_lerp(CITY_RADIUS * 0.85, 0.0, distance), 0.0, 1.0)
	var base := lerpf(2.0, 11.0, core * urban)
	return maxi(1, int(round(base + rng.randf_range(-1.5, 2.5))))

## --------------------------------------------------------------- terrain ----

## Natural, pre-city landscape.
func _wild_height(world_x: float, world_z: float) -> float:
	var base := _terrain.get_noise_2d(world_x, world_z)
	## Reshaping with a power curve flattens valleys and sharpens ridges, which
	## reads as rolling countryside instead of uniform bumps.
	var shaped: float = signf(base) * pow(absf(base), 1.35)
	var fine := _detail.get_noise_2d(world_x, world_z) * 0.06
	return (shaped + fine) * height_scale

## Gentle, smooth grade the city is built on. Streets have to be walkable and
## buildings need level footings, so urban ground uses only the broadest slope.
func _city_height(world_x: float, world_z: float) -> float:
	return _terrain.get_noise_2d(world_x * 0.28, world_z * 0.28) * 4.5

func height_at(world_x: float, world_z: float) -> float:
	var urban := urban_at(world_x, world_z)
	if urban <= 0.001:
		return _wild_height(world_x, world_z)
	# smoothstep keeps the countryside-to-city transition from creasing.
	var blend := smoothstep(0.0, 0.85, urban)
	return lerpf(_wild_height(world_x, world_z), _city_height(world_x, world_z), blend)

func normal_at(world_x: float, world_z: float, delta: float = VERT_SPACING) -> Vector3:
	var left := height_at(world_x - delta, world_z)
	var right := height_at(world_x + delta, world_z)
	var back := height_at(world_x, world_z - delta)
	var front := height_at(world_x, world_z + delta)
	return Vector3(left - right, 2.0 * delta, back - front).normalized()

## 0.0 on a vertical cliff, 1.0 on perfectly flat ground.
func flatness_at(world_x: float, world_z: float) -> float:
	return normal_at(world_x, world_z).y

func forest_density_at(world_x: float, world_z: float) -> float:
	return clampf(inverse_lerp(-0.15, 0.55, _forest.get_noise_2d(world_x, world_z)), 0.0, 1.0)

## --------------------------------------------------------------- colours ----

## Ground colour is baked into terrain vertex colours: cheaper than a shader
## and enough to sell asphalt streets against grass verges.
func ground_color_at(world_x: float, world_z: float, height: float, flatness: float) -> Color:
	const ROCK := Color(0.44, 0.42, 0.40)
	const DRY := Color(0.58, 0.54, 0.35)
	const GRASS := Color(0.28, 0.44, 0.22)
	const LUSH := Color(0.19, 0.37, 0.18)
	const SNOW := Color(0.88, 0.90, 0.93)
	const ASPHALT := Color(0.115, 0.118, 0.128)
	const PAVEMENT := Color(0.60, 0.59, 0.575)
	const PARK := Color(0.26, 0.42, 0.21)

	var urban := urban_at(world_x, world_z)
	var mottle := _detail.get_noise_2d(world_x * 2.0, world_z * 2.0) * 0.045

	if urban > 0.32:
		var d := road_distance(world_x, world_z)
		if d < ROAD_HALF_WIDTH:
			# Slight noise stops the road reading as a flat vector fill.
			var wear := _detail.get_noise_2d(world_x * 3.0, world_z * 3.0) * 0.018
			return Color(
				clampf(ASPHALT.r + wear, 0.0, 1.0),
				clampf(ASPHALT.g + wear, 0.0, 1.0),
				clampf(ASPHALT.b + wear, 0.0, 1.0)
			)
		if d < ROAD_HALF_WIDTH + SIDEWALK_WIDTH:
			var grime := _detail.get_noise_2d(world_x * 4.0, world_z * 4.0) * 0.03
			return Color(
				clampf(PAVEMENT.r + grime, 0.0, 1.0),
				clampf(PAVEMENT.g + grime, 0.0, 1.0),
				clampf(PAVEMENT.b + grime, 0.0, 1.0)
			)

	var altitude := clampf(inverse_lerp(-height_scale * 0.5, height_scale * 0.95, height), 0.0, 1.0)
	var color := GRASS.lerp(LUSH, clampf(forest_density_at(world_x, world_z) * 1.2, 0.0, 1.0))
	color = color.lerp(DRY, clampf(inverse_lerp(0.15, 0.0, altitude), 0.0, 1.0) * 0.7)
	color = color.lerp(ROCK, clampf(inverse_lerp(0.82, 0.45, flatness), 0.0, 1.0))
	color = color.lerp(SNOW, clampf(inverse_lerp(0.86, 1.0, altitude), 0.0, 1.0))
	# Inside town the leftover ground is tended park grass, not wild scrub.
	color = color.lerp(PARK, clampf(urban, 0.0, 1.0) * 0.55)

	return Color(
		clampf(color.r + mottle, 0.0, 1.0),
		clampf(color.g + mottle, 0.0, 1.0),
		clampf(color.b + mottle, 0.0, 1.0)
	)

## Deterministic per-chunk RNG. The stream index lets props of different kinds
## draw independent sequences without interfering with each other.
func rng_for(chunk_coord: Vector2i, stream: int) -> RandomNumberGenerator:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(Vector3i(chunk_coord.x, chunk_coord.y, stream + seed))
	return rng