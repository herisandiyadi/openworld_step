extends Node3D
## Wires the prototype together: makes sure terrain exists around the spawn
## point before dropping the player onto it.
##
## Without this the player can spawn inside a hill (terrain height is
## procedural, so y=0 is not guaranteed to be open air).
##
## Runs in _enter_tree via a deferred call rather than _ready, because sibling
## _ready order is not guaranteed: WorldStreamer must finish building
## world_gen before height_at() can answer.

@export var spawn_clearance: float = 2.0

@onready var world_streamer: WorldStreamer = $WorldStreamer
@onready var player: Player = $Player

func _ready() -> void:
	_place_player.call_deferred()

func _place_player() -> void:
	var spawn_x := player.global_position.x
	var spawn_z := player.global_position.z
	var ground := world_streamer.height_at(spawn_x, spawn_z)
	player.global_position = Vector3(spawn_x, ground + spawn_clearance, spawn_z)