# nengi 2.0 API Reference (alpha.173)

This reference is based on package source and `.d.ts` files from `nengi@2.0.0-alpha.173`.

## Core exports

Main exports include:

- Server: `Instance`, `InstanceNetwork`, `User`, `Channel`, `ChannelAABB2D`, `ChannelAABB3D`, `AABB2D`, `AABB3D`
- Client: `Client`, `ClientNetwork`, `Interpolator`, `Predictor`
- Schema/binary: `Context`, `defineSchema`, `Schema`, `Binary`, `NetworkEvent`, `EngineMessage`

## Schema and context

`defineSchema` auto-adds `ntype` and `nid` to every schema.

- Do not define `ntype` manually.
- Do not define `nid` manually.
- `Context.register(ntype, schema)` maps numeric network type IDs to schemas.

`NType` values should fit in `UInt8` (practically up to 255).

## Server API

### `new Instance(context: Context)`

Important properties:

- `instance.localState`
- `instance.network`
- `instance.queue`
- `instance.users`
- `instance.tick`
- `instance.onConnect = async (handshake) => ...`

Important methods:

- `instance.step()`
- `instance.attachEntity(parentNid, childEntity)`
- `instance.detachEntity(parentNid, childEntity)`
- `instance.respond(endpoint, callback)`

### `NetworkEvent` enum

- `NetworkEvent.UserConnected`
- `NetworkEvent.Command`
- `NetworkEvent.CommandSet`
- `NetworkEvent.UserDisconnected`
- `NetworkEvent.UserConnectionDenied`

In current source, inbound commands are queued as `CommandSet` with `event.commands`.

### `Channel`

- `new Channel(instance.localState)`
- `channel.addEntity(entity)`
- `channel.removeEntity(entity)`
- `channel.addMessage(message)`
- `channel.subscribe(user)`
- `channel.unsubscribe(user)`

### `ChannelAABB2D` and `ChannelAABB3D`

- `new ChannelAABB2D(instance.localState)`
- `new ChannelAABB3D(instance.localState)`
- `subscribe(user, view)` requires view object:
  - 2D: `AABB2D`
  - 3D: `AABB3D`

Entity visibility in `ChannelAABB3D` is based on `entity.x/y/z` against the view AABB.

### Entity ID behavior

`LocalState` assigns `nid` automatically when an entity is first registered through a channel/parent relation.

- ID pool max is `65535` live IDs.
- Reused IDs are returned to pool when entity no longer has any sources.

## Client API

### `new Client(context, adapterCtor, serverTickRate)`

Key methods:

- `await client.connect(wsUrl, handshake)`
- `client.addCommand(command)`
- `client.flush()`
- `client.setDisconnectHandler(handler)`
- `client.setWebsocketErrorHandler(handler)`

### `Interpolator`

- `const interpolator = new Interpolator(client)`
- `interpolator.getInterpolatedState(interpDelayMs)`

Returns frame patches containing:

- `createEntities`
- `updateEntities`
- `deleteEntities`

### `client.network` useful fields

- `messages`
- `frames`
- `latency`
- `predictionErrorFrames`

## Binary types (`Binary` enum)

Built-in schema types:

- Numeric: `UInt8`, `Int8`, `UInt16`, `Int16`, `UInt32`, `Int32`, `Float32`, `Float64`
- Booleans/strings: `Boolean`, `String`
- Typed arrays: `UInt8Array`, `Int8Array`, `UInt16Array`, `Int16Array`, `UInt32Array`, `Int32Array`, `Float32Array`, `Float64Array`
- Geometry: `Vector2`, `Vector3`, `Vector4`, `Quaternion`, `Rotation`, `Rotation32`

`BinaryExt` includes interpolation behavior for many types (including vector/quaternion helpers).

