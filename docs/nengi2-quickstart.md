# nengi 2.0 Quickstart (current alpha API)

This quickstart uses the currently published API shape from `nengi@2.0.0-alpha.173`.

## Install

```bash
npm install nengi@2.0.0-alpha.173 nengi-uws-instance-adapter@0.6.0 nengi-websocket-client-adapter@0.7.0 nengi-buffers@0.5.0 nengi-dataviews@0.4.0
```

## Shared netcode definitions

```ts
// shared/netcode.ts
import { Binary, Context, defineSchema } from 'nengi'

export enum NType {
  InputCommand = 1,
  PlayerEntity = 2,
  IdentityMessage = 3,
}

export const inputCommandSchema = defineSchema({
  forward: Binary.Float32,
  strafe: Binary.Float32,
  jump: Binary.Boolean,
  delta: Binary.Float32,
})

export const playerEntitySchema = defineSchema({
  x: { type: Binary.Float32, interp: true },
  y: { type: Binary.Float32, interp: true },
  z: { type: Binary.Float32, interp: true },
  yaw: { type: Binary.Rotation32, interp: true },
  pitch: { type: Binary.Rotation32, interp: true },
})

export const identityMessageSchema = defineSchema({
  playerNid: Binary.UInt16,
})

export const ncontext = new Context()
ncontext.register(NType.InputCommand, inputCommandSchema)
ncontext.register(NType.PlayerEntity, playerEntitySchema)
ncontext.register(NType.IdentityMessage, identityMessageSchema)
```

## Server skeleton

```ts
// server/net.ts
import {
  Instance,
  Channel,
  ChannelAABB3D,
  AABB3D,
  NetworkEvent,
} from 'nengi'
import { uWebSocketsInstanceAdapter } from 'nengi-uws-instance-adapter'
import { ncontext, NType } from '../shared/netcode'

const TICK_MS = 50 // 20hz
const PORT = 9001

const instance = new Instance(ncontext)
instance.onConnect = async (handshake: any) => {
  if (!handshake?.token) throw new Error('Missing token')
  return { ok: true }
}

const adapter = new uWebSocketsInstanceAdapter(instance.network, {})
adapter.listen(PORT, () => console.log(`nengi server on :${PORT}`))

const globalChannel = new Channel(instance.localState)
const spatialChannel = new ChannelAABB3D(instance.localState)
const userToEntity = new Map<number, any>()

function update() {
  while (!instance.queue.isEmpty()) {
    const event: any = instance.queue.next()

    if (event.type === NetworkEvent.UserConnected) {
      const user = event.user
      const player = { nid: 0, ntype: NType.PlayerEntity, x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0 }

      globalChannel.subscribe(user)
      spatialChannel.addEntity(player)
      userToEntity.set(user.id, player)

      const view = new AABB3D(player.x, player.y, player.z, 128, 64, 128)
      ;(user as any).view = view
      spatialChannel.subscribe(user, view)

      user.queueMessage({ ntype: NType.IdentityMessage, playerNid: player.nid })
    }

    if (event.type === NetworkEvent.CommandSet) {
      const user = event.user
      const player = userToEntity.get(user.id)
      if (!player) continue

      for (const cmd of event.commands ?? []) {
        if (cmd.ntype !== NType.InputCommand) continue
        const speed = 6
        player.x += cmd.strafe * speed * cmd.delta
        player.z += cmd.forward * speed * cmd.delta
      }

      const view = (user as any).view
      if (view) {
        view.x = player.x
        view.y = player.y
        view.z = player.z
      }
    }

    if (event.type === NetworkEvent.UserDisconnected) {
      const user = event.user
      const player = userToEntity.get(user.id)
      if (player) {
        spatialChannel.removeEntity(player)
        userToEntity.delete(user.id)
      }
    }
  }

  instance.step()
}

setInterval(update, TICK_MS)
```

## Client skeleton

```ts
// client/net.ts
import { Client, Interpolator } from 'nengi'
import { WebSocketClientAdapter } from 'nengi-websocket-client-adapter'
import { ncontext, NType } from '../shared/netcode'

const SERVER_TPS = 20
const INTERP_DELAY_MS = 100

const client = new Client(ncontext, WebSocketClientAdapter, SERVER_TPS)
const interpolator = new Interpolator(client)

await client.connect('ws://localhost:9001', { token: 'dev-token' })

function netTick(delta: number, input: { forward: number; strafe: number; jump: boolean }) {
  while (client.network.messages.length > 0) {
    const message = client.network.messages.pop()
    if (message?.ntype === NType.IdentityMessage) {
      // store controlled player nid
    }
  }

  const frames = interpolator.getInterpolatedState(INTERP_DELAY_MS)
  for (const frame of frames) {
    for (const entity of frame.createEntities) {
      // spawn render entity
    }
    for (const diff of frame.updateEntities) {
      // apply position/rotation/property diff
    }
    for (const nid of frame.deleteEntities) {
      // despawn render entity
    }
  }

  client.addCommand({
    ntype: NType.InputCommand,
    forward: input.forward,
    strafe: input.strafe,
    jump: input.jump,
    delta,
  })
  client.flush()
}
```

## Practical rules

- Run simulation at fixed tick (`20hz` or `30hz`) and call `instance.step()` exactly once per server tick.
- Send one command bundle per client tick with `client.addCommand(...)` then `client.flush()`.
- Keep entities flat. Prefer extra entities/components over nested object properties.
- Keep AABB view updated every server tick for culling channels.

