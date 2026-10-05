"""Deterministic Blender setup for game asset exports. Run with Blender --background --python."""
import bpy

SCENE_NAME = "AssetTemplate"

def configure_scene():
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = 'METERS'
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene['asset_pipeline'] = {'unit_meters': 1, 'runtime': 'glb', 'lightmap_uv': 'UVMap.001', 'mesh_compression': 'meshopt'}
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            obj.data.validate(verbose=False)
            if len(obj.data.uv_layers) < 2:
                obj.data.uv_layers.new(name='LightmapUV')
            obj.data.uv_layers.active_index = 0
            obj.data.uv_layers.active_render_index = 0

if __name__ == '__main__':
    configure_scene()
