extends StaticBody3D
class_name TerrainChunk
## One square tile of terrain, built procedurally at runtime.
##
## Two deliberate choices here matter for mobile performance:
##   * Ground colour is baked into vertex colours instead of a shader or
##     texture, so the whole chunk still draws with one shared material.
##   * Collision uses HeightMapShape3D rather than a trimesh. A heightfield is
##     dramatically cheaper to build and to query, and it is exact for terrain
##     that is a pure height function of (x, z).

var chunk_coord: Vector2i = Vector2i.ZERO

func build(coord: Vector2i, world_gen: WorldGen, material: Material) -> void:
	chunk_coord = coord
	position = Vector3(coord.x * WorldGen.CHUNK_SIZE, 0.0, coord.y * WorldGen.CHUNK_SIZE)

	var heights := _sample_heights(coord, world_gen)

	var mesh_instance := MeshInstance3D.new()
	mesh_instance.mesh = _build_mesh(coord, world_gen, heights)
	mesh_instance.material_override = material
	add_child(mesh_instance)

	add_child(_build_collision(heights))

## Heights are sampled once and reused for both the mesh and the collision
## shape, which keeps the visual surface and the walkable surface identical.
func _sample_heights(coord: Vector2i, world_gen: WorldGen) -> PackedFloat32Array:
	var verts := WorldGen.VERTS_PER_SIDE
	var origin_x := coord.x * WorldGen.CHUNK_SIZE
	var origin_z := coord.y * WorldGen.CHUNK_SIZE

	var heights := PackedFloat32Array()
	heights.resize(verts * verts)

	for z in verts:
		for x in verts:
			heights[z * verts + x] = world_gen.height_at(
				origin_x + x * WorldGen.VERT_SPACING,
				origin_z + z * WorldGen.VERT_SPACING
			)
	return heights

func _build_mesh(coord: Vector2i, world_gen: WorldGen, heights: PackedFloat32Array) -> ArrayMesh:
	var verts := WorldGen.VERTS_PER_SIDE
	var origin_x := coord.x * WorldGen.CHUNK_SIZE
	var origin_z := coord.y * WorldGen.CHUNK_SIZE

	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()

	vertices.resize(verts * verts)
	normals.resize(verts * verts)
	colors.resize(verts * verts)
	uvs.resize(verts * verts)

	for z in verts:
		for x in verts:
			var index := z * verts + x
			var local_x := x * WorldGen.VERT_SPACING
			var local_z := z * WorldGen.VERT_SPACING
			var world_x := origin_x + local_x
			var world_z := origin_z + local_z
			var height := heights[index]

			var normal := world_gen.normal_at(world_x, world_z)
			vertices[index] = Vector3(local_x, height, local_z)
			normals[index] = normal
			colors[index] = world_gen.ground_color_at(world_x, world_z, height, normal.y)
			uvs[index] = Vector2(float(x) / float(verts - 1), float(z) / float(verts - 1))

	for z in verts - 1:
		for x in verts - 1:
			var i := z * verts + x
			indices.append_array([i, i + verts, i + 1])
			indices.append_array([i + 1, i + verts, i + verts + 1])

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices

	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh

## HeightMapShape3D is centred on its origin, so the collision node is shifted
## to the middle of the chunk. This only lines up because VERT_SPACING is 1.0,
## which is the spacing the shape assumes between samples.
func _build_collision(heights: PackedFloat32Array) -> CollisionShape3D:
	var shape := HeightMapShape3D.new()
	shape.map_width = WorldGen.VERTS_PER_SIDE
	shape.map_depth = WorldGen.VERTS_PER_SIDE
	shape.map_data = heights

	var collision := CollisionShape3D.new()
	collision.shape = shape
	collision.position = Vector3(WorldGen.CHUNK_SIZE * 0.5, 0.0, WorldGen.CHUNK_SIZE * 0.5)
	return collision