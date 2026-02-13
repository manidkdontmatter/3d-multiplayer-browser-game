# nengi 2.0 Mismatch Notes (Important)

There are conflicting examples online and even in some nengi materials.  
Use this file to avoid mixing incompatible API generations.

## Current alpha.173 behavior vs older examples

## Instance construction

- Older examples: `new Instance(ncontext, BufferWriter)`
- Current package source: `new Instance(ncontext)`

## Event queue location

- Older examples: `instance.network.queue`
- Current package source: `instance.queue`

## Command event shape

- Older examples commonly handle `NetworkEvent.Command` with `event.command`
- Current package source parses commands into `NetworkEvent.CommandSet` with `event.commands`

## Adapter registration

- Older examples: `instance.network.registerNetworkAdapter(adapter)`
- Current package source: adapters call `instance.network` methods directly; no `registerNetworkAdapter` API in current typings

## Spatial view names

- Older examples mention `ViewAABB`
- Current package exports and uses `AABB2D` and `AABB3D`

## Channel creation helpers

- Older examples use helpers like `instance.createChannel()` and `instance.createSpatialChannel()`
- Current package source uses constructors directly:
  - `new Channel(instance.localState)`
  - `new ChannelAABB2D(instance.localState)`
  - `new ChannelAABB3D(instance.localState)`

## Example repos status

From maintainer repos:

- Many repos (`nengi-2d-basic`, `nengi-2d-csp`, `nengi-barebone`, `nengi-tutorials`, `nengi-babylon-3d-shooter`) are nengi 1.x based.
- `nengi-ecs-prototype` uses `github:timetocode/nengi#nengi2-experimental` (early nengi 2 branch) and does not match current npm alpha exactly.

Use those repos only for conceptual patterns, not copy-paste API.

## Team rule for this project

- Prefer package source (`nengi@2.0.0-alpha.173`) and current adapter source as the single source of truth.
- If external snippet conflicts with local docs, follow local docs and re-verify against package source.

