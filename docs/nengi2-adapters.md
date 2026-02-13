# nengi 2.0 Adapters and Transport Notes

## Recommended browser game stack

- Server adapter: `nengi-uws-instance-adapter`
- Client adapter: `nengi-websocket-client-adapter`
- Server binary implementation: `nengi-buffers`
- Browser binary implementation: `nengi-dataviews`

Install:

```bash
npm install nengi@2.0.0-alpha.173 nengi-uws-instance-adapter@0.6.0 nengi-websocket-client-adapter@0.7.0 nengi-buffers@0.5.0 nengi-dataviews@0.4.0
```

## Adapter constructor usage

Server:

```ts
const adapter = new uWebSocketsInstanceAdapter(instance.network, {})
adapter.listen(9001, () => {})
```

Client:

```ts
const client = new Client(ncontext, WebSocketClientAdapter, 20)
await client.connect('ws://localhost:9001', handshake)
```

## Server adapter interface

Your adapter must provide:

- `listen(port, ready)`
- `send(user, buffer)`
- `disconnect(user, reason)`
- `createBuffer(lengthInBytes)`
- `createBufferWriter(lengthInBytes)`
- `createBufferReader(buffer)`

## Client adapter interface

Your adapter must provide:

- `connect(wsUrl, handshake)`
- `flush()`
- `createBuffer(lengthInBytes)`
- `createBufferWriter(lengthInBytes)`
- `createBufferReader(buffer)`

## Handshake and connection flow

Flow from package source:

1. Socket opens.
2. Client sends engine message `ConnectionAttempt` with JSON handshake.
3. Server runs `instance.onConnect(handshake)`.
4. Server returns `ConnectionAccepted` or `ConnectionDenied`.
5. Client starts normal snapshot parsing only after accept.

## Compatibility warning for legacy adapters/examples

`nengi-ws-instance-adapter@0.1.0` appears to target an older alpha API shape (for example, different `User` construction style in source).  
Treat it as legacy unless you validate it against your exact nengi version.

## High-performance note

For your target (100+ concurrent players), prefer:

- `uWebSockets.js` server adapter path
- channel-based visibility (`ChannelAABB3D`)
- fixed tick cadence and strict command batching
- no nested schema payloads; keep hot-path schemas flat and compact

