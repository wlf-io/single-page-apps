// WebRTC data channels for browsers that share a secret and a public server.
//
//   Rtc.init(baseSecret)
//     Required before the dialog is shown. The secret entered in the dialog
//     is mixed with baseSecret first, so two apps stay apart when people
//     type the same secret.
//   Rtc.peers() -> [{ id, name }]
//   Rtc.send(peerId, id, name, blob)
//   Rtc.sendAll(id, name, blob)
//   Rtc.onMessage((message) => {})
//     message is { id, name, blob, peer }
//     peer is { id, name } for the sender
//     returns a function that removes the hook
//   Rtc.onPeerConnect((peer) => {})
//   Rtc.onPeerDisconnect((peer) => {})
//     peer is { id, name }
//     fired when a peer's data channel opens, and when that peer leaves
//     returns a function that removes the hook
//
// Application messages on the wire are JSON text: { id, name, blob }.
// The selected server only introduces the browsers. The bytes afterwards
// travel on a normal WebRTC data channel, using the STUN servers below.

(() => {
  "use strict";

  const STUN = [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
    "stun:stun.cloudflare.com:3478",
  ];

  const SERVERS = [
    {
      id: "mosquitto",
      name: "Eclipse Mosquitto",
      kind: "mqtt",
      url: "wss://test.mosquitto.org:8081",
    },
    {
      id: "emqx",
      name: "EMQX",
      kind: "mqtt",
      url: "wss://broker.emqx.io:8084/mqtt",
    },
    {
      id: "openwebtorrent",
      name: "Open WebTorrent",
      kind: "tracker",
      url: "wss://tracker.openwebtorrent.com",
    },
    {
      id: "webtorrent",
      name: "WebTorrent",
      kind: "tracker",
      url: "wss://tracker.webtorrent.dev",
    },
  ];

  const messageHandlers = new Set();
  const peerConnectHandlers = new Set();
  const peerDisconnectHandlers = new Set();
  let active = null;
  let mounted = false;
  let baseSecret = null;

  const Rtc = {
    init(secret) {
      if (typeof secret !== "string" || secret.length === 0) {
        throw new TypeError("Base secret must be a non-empty string.");
      }
      if (baseSecret !== null) throw new Error("Already initialized.");
      baseSecret = secret;
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
      else mount();
    },
    peers() {
      return active ? active.peers() : [];
    },
    send(peerId, id, name, blob) {
      if (!active) throw new Error("Not connected");
      active.send(peerId, id, name, blob);
    },
    sendAll(id, name, blob) {
      if (!active) throw new Error("Not connected");
      active.sendAll(id, name, blob);
    },
    onMessage(handler) {
      if (typeof handler !== "function") throw new TypeError("handler must be a function");
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onPeerConnect(handler) {
      if (typeof handler !== "function") throw new TypeError("handler must be a function");
      peerConnectHandlers.add(handler);
      return () => peerConnectHandlers.delete(handler);
    },
    onPeerDisconnect(handler) {
      if (typeof handler !== "function") throw new TypeError("handler must be a function");
      peerDisconnectHandlers.add(handler);
      return () => peerDisconnectHandlers.delete(handler);
    },
  };

  globalThis.Rtc = Rtc;

  function concat(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function randomBytes(size) {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function bytesToHex(bytes) {
    let hex = "";
    for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
    return hex;
  }

  function bytesToBinary(bytes) {
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return text;
  }

  function binaryToHex(text) {
    let hex = "";
    for (let i = 0; i < text.length; i++) {
      hex += (text.charCodeAt(i) & 255).toString(16).padStart(2, "0");
    }
    return hex;
  }

  function bytesToBase64(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return btoa(text);
  }

  function base64ToBytes(text) {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function encodeRemaining(length) {
    const out = [];
    do {
      let byte = length % 128;
      length = Math.floor(length / 128);
      if (length > 0) byte |= 128;
      out.push(byte);
    } while (length > 0);
    return Uint8Array.from(out);
  }

  function mqttString(text) {
    const bytes = new TextEncoder().encode(text);
    return concat([Uint8Array.of((bytes.length >> 8) & 255, bytes.length & 255), bytes]);
  }

  function mqttPacket(type, body) {
    return concat([Uint8Array.of(type), encodeRemaining(body.length), body]);
  }

  function takePackets(bytes) {
    const packets = [];
    let offset = 0;
    while (offset < bytes.length) {
      let multiplier = 1;
      let length = 0;
      let cursor = offset + 1;
      let digit = 0;
      do {
        if (cursor >= bytes.length) return { packets, rest: bytes.slice(offset) };
        digit = bytes[cursor++];
        length += (digit & 127) * multiplier;
        multiplier *= 128;
        if (multiplier > 128 * 128 * 128 * 128) return { packets, rest: new Uint8Array() };
      } while (digit & 128);
      if (cursor + length > bytes.length) return { packets, rest: bytes.slice(offset) };
      packets.push({ type: bytes[offset], body: bytes.slice(cursor, cursor + length) });
      offset = cursor + length;
    }
    return { packets, rest: new Uint8Array() };
  }

  async function sha256(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return new Uint8Array(digest);
  }

  async function mixSecret(secret) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(baseSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(secret)));
    return bytesToHex(mac);
  }

  async function deriveKey(secret) {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode("rtc-lib/v1"),
        iterations: 100000,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function seal(key, value) {
    const iv = randomBytes(12);
    const plain = new TextEncoder().encode(JSON.stringify(value));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
    return bytesToBase64(concat([iv, cipher]));
  }

  async function open(key, boxed) {
    try {
      const packed = base64ToBytes(boxed);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: packed.slice(0, 12) },
        key,
        packed.slice(12)
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      return null;
    }
  }

  function createPeerConnection() {
    return new RTCPeerConnection({ iceServers: STUN.map((urls) => ({ urls })) });
  }

  function waitForIce(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        pc.removeEventListener("icegatheringstatechange", onState);
        pc.removeEventListener("icecandidate", onCandidate);
        clearTimeout(timer);
        resolve();
      };
      const onState = () => {
        if (pc.iceGatheringState === "complete") finish();
      };
      const onCandidate = (event) => {
        if (!event.candidate) finish();
      };
      pc.addEventListener("icegatheringstatechange", onState);
      pc.addEventListener("icecandidate", onCandidate);
      const timer = setTimeout(finish, 4000);
    });
  }

  async function describe(pc, kind) {
    const description = kind === "offer" ? await pc.createOffer() : await pc.createAnswer();
    await pc.setLocalDescription(description);
    await waitForIce(pc);
    return pc.localDescription.sdp;
  }

  function createPool(selfId, myName, onChange) {
    const peers = new Map();
    const connected = new Set();

    function preferred(initiated, remoteId) {
      return (selfId < remoteId) === initiated;
    }

    function emit(handlers, payload) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(err);
        }
      }
    }

    function emitMessage(record, message) {
      emit(messageHandlers, {
        id: message.id,
        name: message.name,
        blob: message.blob,
        peer: { id: record.id, name: record.name },
      });
    }

    function emitPeer(handlers, record) {
      emit(handlers, { id: record.id, name: record.name });
    }

    function drop(record, channel, pc) {
      const current = peers.get(record.id);
      if (!current) return;
      if (channel && current.channel !== channel) return;
      if (pc && current.pc !== pc) return;
      peers.delete(record.id);
      const wasConnected = connected.delete(record.id);
      onChange();
      if (wasConnected) emitPeer(peerDisconnectHandlers, record);
    }

    function bindChannel(record, channel) {
      if (record.channel && record.channel !== channel) channel.close();
      record.channel = channel;
      channel.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!message || typeof message !== "object") return;
        if (typeof message.id === "string" && typeof message.name === "string" && "blob" in message) {
          emitMessage(record, message);
          return;
        }
        if (typeof message.hello === "string") {
          record.name = message.hello;
          onChange();
        }
      };
      channel.onopen = () => {
        if (peers.get(record.id)?.channel !== channel) return;
        channel.send(JSON.stringify({ hello: myName }));
        if (!connected.has(record.id)) {
          connected.add(record.id);
          emitPeer(peerConnectHandlers, record);
        }
        onChange();
      };
      channel.onclose = () => drop(record, channel, null);
      if (channel.readyState === "open") channel.onopen();
    }

    function attach(remoteId, name, pc, channel, initiated) {
      const prev = peers.get(remoteId);
      if (prev && prev.pc.connectionState !== "failed" && prev.pc.connectionState !== "closed") {
        const keepPrevious = preferred(prev.initiated, remoteId) || !preferred(initiated, remoteId);
        if (keepPrevious) {
          if (name) prev.name = name;
          pc.close();
          return prev;
        }
      }

      const record = {
        id: remoteId,
        name: name || prev?.name || "",
        pc,
        channel: null,
        initiated,
      };
      peers.set(remoteId, record);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") drop(record, null, pc);
      };
      pc.ondatachannel = (event) => bindChannel(record, event.channel);
      if (channel) bindChannel(record, channel);
      if (prev && prev.pc !== pc) prev.pc.close();
      return record;
    }

    function list() {
      const out = [];
      for (const record of peers.values()) {
        if (record.channel?.readyState === "open") out.push({ id: record.id, name: record.name });
      }
      out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return out;
    }

    function encodeMessage(id, name, blob) {
      return JSON.stringify({ id, name, blob: blob === undefined ? null : blob });
    }

    function send(peerId, id, name, blob) {
      if (typeof peerId !== "string" || typeof id !== "string" || typeof name !== "string") {
        throw new TypeError("peerId, id, and name must be strings");
      }
      const record = peers.get(peerId);
      if (!record || record.channel?.readyState !== "open") throw new Error("Peer is not connected");
      record.channel.send(encodeMessage(id, name, blob));
    }

    function sendAll(id, name, blob) {
      if (typeof id !== "string" || typeof name !== "string") {
        throw new TypeError("id and name must be strings");
      }
      const text = encodeMessage(id, name, blob);
      for (const record of peers.values()) {
        if (record.channel?.readyState === "open") record.channel.send(text);
      }
    }

    function close() {
      const leaving = [];
      for (const record of peers.values()) {
        if (connected.delete(record.id)) leaving.push(record);
      }
      const records = [...peers.values()];
      peers.clear();
      for (const record of records) record.pc.close();
      onChange();
      for (const record of leaving) emitPeer(peerDisconnectHandlers, record);
    }

    return { peers, attach, list, send, sendAll, close };
  }

  function openSocket(url, protocols, serverName) {
    const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
    const opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out reaching " + serverName + "."));
      }, 8000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not reach " + serverName + "."));
      }, { once: true });
    });
    return { ws, opened };
  }

  async function startMqtt(options, pool, selfId, key) {
    const { ws, opened } = openSocket(options.server.url, ["mqtt"], options.server.name);
    const topic = "rtc-lib/v1/" + bytesToHex(options.digest);
    let buffer = new Uint8Array();
    let pingTimer = 0;
    const inbox = [];
    let wakeInbox = () => {};

    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (event) => {
      const chunk = new Uint8Array(event.data);
      buffer = concat([buffer, chunk]);
      const taken = takePackets(buffer);
      buffer = taken.rest;
      if (!taken.packets.length) return;
      inbox.push(...taken.packets);
      wakeInbox();
    });

    function nextPacket() {
      if (inbox.length) return Promise.resolve(inbox.shift());
      if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        wakeInbox = () => {
          wakeInbox = () => {};
          resolve(inbox.shift() || null);
        };
      });
    }

    ws.addEventListener("close", () => wakeInbox());

    await opened;
    if (options.stopped()) throw new Error(options.server.name + " closed the connection.");

    const clientId = "rtc" + bytesToHex(randomBytes(8));
    ws.send(mqttPacket(
      0x10,
      concat([
        mqttString("MQTT"),
        Uint8Array.of(4, 0x02),
        Uint8Array.of(0, 30),
        mqttString(clientId),
      ])
    ));

    const connack = await Promise.race([
      nextPacket(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(options.server.name + " did not accept the connection.")), 8000);
      }),
    ]);
    if ((connack.type & 0xf0) !== 0x20 || connack.body[1] !== 0) {
      throw new Error(options.server.name + " refused the connection.");
    }

    ws.send(mqttPacket(0x82, concat([Uint8Array.of(0, 1), mqttString(topic), Uint8Array.of(0)])));
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(new Uint8Array([0xc0, 0x00]));
    }, 20000);

    const seen = new Set();
    const offering = new Set();

    async function publish(inner) {
      if (ws.readyState !== WebSocket.OPEN) return;
      const box = await seal(key, inner);
      ws.send(mqttPacket(0x30, concat([mqttString(topic), new TextEncoder().encode(JSON.stringify({ box }))])));
    }

    function publishHello() {
      return publish({ from: selfId, to: null, kind: "hello", name: options.name });
    }

    async function offer(remoteId, name) {
      if (options.stopped() || offering.has(remoteId)) return;
      const existing = pool.peers.get(remoteId);
      if (existing && existing.pc.connectionState !== "failed" && existing.pc.connectionState !== "closed") return;
      offering.add(remoteId);
      const pc = createPeerConnection();
      const channel = pc.createDataChannel("data");
      try {
        const record = pool.attach(remoteId, name, pc, channel, true);
        if (record.pc !== pc) return;
        const sdp = await describe(pc, "offer");
        if (options.stopped() || pool.peers.get(remoteId)?.pc !== pc) return;
        await publish({ from: selfId, to: remoteId, kind: "offer", name: options.name, sdp });
      } catch {
        if (pool.peers.get(remoteId)?.pc === pc) pc.close();
      } finally {
        offering.delete(remoteId);
      }
    }

    async function acceptOffer(remoteId, name, sdp) {
      const pc = createPeerConnection();
      const record = pool.attach(remoteId, name, pc, null, false);
      if (record.pc !== pc) return;
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await describe(pc, "answer");
      if (options.stopped() || pool.peers.get(remoteId)?.pc !== pc) return;
      await publish({ from: selfId, to: remoteId, kind: "answer", name: options.name, sdp: answer });
    }

    async function handle(inner) {
      if (!inner || inner.from === selfId || typeof inner.from !== "string") return;
      if (inner.to && inner.to !== selfId) return;
      const name = typeof inner.name === "string" ? inner.name : "";
      if (inner.kind === "hello") {
        const first = !seen.has(inner.from);
        seen.add(inner.from);
        const record = pool.peers.get(inner.from);
        if (record && name) {
          record.name = name;
          options.onPeers();
        }
        if (first) publishHello();
        if (selfId > inner.from) offer(inner.from, name);
        return;
      }
      if (inner.kind === "bye") {
        const record = pool.peers.get(inner.from);
        seen.delete(inner.from);
        if (record) record.pc.close();
        return;
      }
      if (typeof inner.sdp !== "string") return;
      if (inner.kind === "offer") await acceptOffer(inner.from, name, inner.sdp);
      if (inner.kind === "answer") {
        const record = pool.peers.get(inner.from);
        if (!record || record.pc.signalingState !== "have-local-offer") return;
        await record.pc.setRemoteDescription({ type: "answer", sdp: inner.sdp });
      }
    }

    (async () => {
      while (!options.stopped() && ws.readyState === WebSocket.OPEN) {
        const packet = await nextPacket();
        if (options.stopped() || !packet) return;
        if ((packet.type & 0xf0) !== 0x30) continue;
        const topicLength = (packet.body[0] << 8) | packet.body[1];
        if (packet.body.length < 2 + topicLength) continue;
        const payload = new TextDecoder().decode(packet.body.slice(2 + topicLength));
        try {
          const outer = JSON.parse(payload);
          await handle(await open(key, outer.box));
        } catch (err) {
          console.error(err);
        }
      }
    })();

    await publishHello();
    const helloTimer = setInterval(() => {
      if (!options.stopped()) publishHello();
    }, 12000);

    return {
      socket: ws,
      stop() {
        clearInterval(pingTimer);
        clearInterval(helloTimer);
        if (ws.readyState === WebSocket.OPEN) {
          publish({ from: selfId, to: null, kind: "bye", name: options.name });
          ws.send(new Uint8Array([0xe0, 0x00]));
          ws.close();
        }
      },
    };
  }

  async function startTracker(options, pool, peerId, key) {
    const { ws, opened } = openSocket(options.server.url, null, options.server.name);
    const infoHash = bytesToBinary(options.digest.slice(0, 20));
    const pending = new Map();
    let started = true;
    let announcing = false;
    let retryTimer = 0;
    let lastStats = null;
    let sawResponse = null;

    function send(message) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    }

    function planNext() {
      clearTimeout(retryTimer);
      if (options.stopped()) return;
      const others = lastStats ? Math.max(0, lastStats.complete + lastStats.incomplete - 1) : 0;
      const interval = ((lastStats && lastStats.interval) || 120) * 1000;
      const delay = pool.list().length < others ? Math.min(5000, interval) : interval;
      retryTimer = setTimeout(() => announce(), delay);
    }

    async function announce() {
      if (options.stopped() || announcing || ws.readyState !== WebSocket.OPEN) return;
      announcing = true;
      try {
        for (const [offerId, item] of pending) {
          if (Date.now() - item.at > 25000) {
            item.pc.close();
            pending.delete(offerId);
          }
        }
        const others = lastStats ? Math.max(0, lastStats.complete + lastStats.incomplete - 1) : 0;
        const missing = Math.max(0, others - pool.list().length);
        const count = Math.min(5, Math.max(2, missing || 2));
        const offers = [];
        for (let i = 0; i < count; i++) {
          if (options.stopped()) return;
          const pc = createPeerConnection();
          try {
            const channel = pc.createDataChannel("data");
            const offerId = bytesToBinary(randomBytes(20));
            const sdp = await seal(key, { sdp: await describe(pc, "offer"), name: options.name });
            if (options.stopped()) {
              pc.close();
              return;
            }
            pending.set(offerId, { pc, channel, at: Date.now() });
            offers.push({ offer: { type: "offer", sdp }, offer_id: offerId });
          } catch (err) {
            pc.close();
            throw err;
          }
        }
        const message = {
          action: "announce",
          info_hash: infoHash,
          peer_id: peerId,
          downloaded: 0,
          uploaded: 0,
          left: 1,
          offers,
        };
        if (started) message.event = "started";
        started = false;
        send(message);
      } finally {
        announcing = false;
      }
    }

    async function acceptOffer(data) {
      if (typeof data.peer_id !== "string" || data.peer_id === peerId) return;
      if (typeof data.offer_id !== "string" || !data.offer?.sdp) return;
      const remoteId = binaryToHex(data.peer_id);
      const openedSdp = await open(key, data.offer.sdp);
      if (!openedSdp || typeof openedSdp.sdp !== "string") return;
      const pc = createPeerConnection();
      const record = pool.attach(remoteId, openedSdp.name || "", pc, null, false);
      if (record.pc !== pc) return;
      await pc.setRemoteDescription({ type: "offer", sdp: openedSdp.sdp });
      const answer = await seal(key, { sdp: await describe(pc, "answer"), name: options.name });
      if (options.stopped() || pool.peers.get(remoteId)?.pc !== pc) return;
      send({
        action: "announce",
        info_hash: infoHash,
        peer_id: peerId,
        to_peer_id: data.peer_id,
        offer_id: data.offer_id,
        answer: { type: "answer", sdp: answer },
        downloaded: 0,
        uploaded: 0,
        left: 1,
      });
    }

    async function acceptAnswer(data) {
      const item = pending.get(data.offer_id);
      if (!item || typeof data.peer_id !== "string") return;
      pending.delete(data.offer_id);
      const openedSdp = await open(key, data.answer?.sdp);
      if (!openedSdp || typeof openedSdp.sdp !== "string") {
        item.pc.close();
        return;
      }
      const remoteId = binaryToHex(data.peer_id);
      const record = pool.attach(remoteId, openedSdp.name || "", item.pc, item.channel, true);
      if (record.pc !== item.pc || record.pc.signalingState !== "have-local-offer") return;
      await record.pc.setRemoteDescription({ type: "answer", sdp: openedSdp.sdp });
    }

    ws.addEventListener("message", async (event) => {
      if (options.stopped()) return;
      const raw = typeof event.data === "string" ? event.data : await event.data.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      if (data["failure reason"]) {
        sawResponse?.(new Error(options.server.name + " rejected the room."));
        return;
      }
      if (typeof data.info_hash === "string" && data.info_hash !== infoHash) return;
      if (typeof data.complete === "number") {
        lastStats = data;
        sawResponse?.(null);
        planNext();
      }
      try {
        if (data.offer) await acceptOffer(data);
        if (data.answer) await acceptAnswer(data);
      } catch (err) {
        console.error(err);
      }
    });

    await opened;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(options.server.name + " did not answer.")), 8000);
      sawResponse = (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
    });
    await announce();
    await response;

    return {
      socket: ws,
      stop() {
        clearTimeout(retryTimer);
        for (const item of pending.values()) item.pc.close();
        pending.clear();
        if (ws.readyState === WebSocket.OPEN) {
          send({
            action: "announce",
            info_hash: infoHash,
            peer_id: peerId,
            downloaded: 0,
            uploaded: 0,
            left: 0,
            event: "stopped",
          });
          ws.close();
        }
      },
    };
  }

  async function connect(options) {
    if (!crypto.subtle) throw new Error("A secure page is required to connect.");
    if (typeof RTCPeerConnection !== "function") throw new Error("This browser cannot open WebRTC connections.");

    let stopped = false;
    let ready = false;
    let transport = null;
    if (baseSecret === null) throw new Error("Call Rtc.init before connecting.");
    const mixed = await mixSecret(options.secret);
    const key = await deriveKey(mixed);
    const digest = await sha256(mixed);
    const idBytes = randomBytes(20);
    const selfId = bytesToHex(idBytes);
    const pool = createPool(selfId, options.name, () => {
      if (ready) options.onPeers();
    });
    const session = {
      peers() {
        return pool.list();
      },
      send(peerId, id, name, blob) {
        pool.send(peerId, id, name, blob);
      },
      sendAll(id, name, blob) {
        pool.sendAll(id, name, blob);
      },
      stop() {
        shutdown();
      },
    };

    function shutdown() {
      if (stopped) return false;
      stopped = true;
      transport?.stop();
      pool.close();
      if (active === session) active = null;
      return true;
    }

    const sessionOptions = {
      server: options.server,
      name: options.name,
      digest,
      onPeers: () => {
        if (ready) options.onPeers();
      },
      stopped: () => stopped,
    };

    try {
      transport = options.server.kind === "mqtt"
        ? await startMqtt(sessionOptions, pool, selfId, key)
        : await startTracker(sessionOptions, pool, bytesToBinary(idBytes), key);
      transport.socket.addEventListener("close", () => {
        if (!shutdown()) return;
        if (ready) options.onDown(new Error(options.server.name + " closed the connection."));
      });
    } catch (err) {
      shutdown();
      throw err;
    }

    ready = true;
    active = session;
    return session;
  }

  function storageGet(store, key) {
    try {
      return store.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function storageSet(store, key, value) {
    try {
      store.setItem(key, value);
    } catch {
      /* private mode */
    }
  }

  function normalizeKind(value) {
    return value === "mqtt" || value === "tracker" ? value : "";
  }

  function parseServerUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      if (url.protocol !== "wss:" && url.protocol !== "ws:") return "";
      return text;
    } catch {
      return "";
    }
  }

  function serverFromHash(data) {
    const known = SERVERS.find((server) => server.id === data.server);
    if (known) return known;
    if (data.server !== "custom") return null;
    const kind = normalizeKind(data.kind);
    const url = parseServerUrl(data.url);
    if (!kind || !url) return null;
    return { id: "custom", name: url, kind, url };
  }

  function getHashData() {
    const hash = location.hash.slice(1);
    // Split the hash string (like a query string) into a key-value object, using & and first = as separators
    const result = {};
    if (hash) {
      for (const part of hash.split("&")) {
        const idx = part.indexOf("=");
        if (idx !== -1) {
          const key = decodeURIComponent(part.slice(0, idx));
          const value = decodeURIComponent(part.slice(idx + 1));
          result[key] = value;
        } else {
          result[decodeURIComponent(part)] = "";
        }
      }
    }
    return result;
  }

  function mount() {
    if (mounted) return;
    const root = document.getElementById("rtc-container");
    if (!root) throw new Error("Missing #rtc-container.");
    mounted = true;
    const hashData = getHashData();
    let serverId = hashData.server || storageGet(localStorage, "rtc-lib:server") || SERVERS[0].id;
    if (serverId !== "custom" && !SERVERS.some((server) => server.id === serverId)) serverId = SERVERS[0].id;
    let customKind = normalizeKind(storageGet(localStorage, "rtc-lib:custom-kind")) || "mqtt";
    let customUrl = storageGet(localStorage, "rtc-lib:custom-url");
    if (hashData.server === "custom") {
      const hashKind = normalizeKind(hashData.kind);
      if (hashKind) customKind = hashKind;
      if (Object.prototype.hasOwnProperty.call(hashData, "url")) customUrl = hashData.url;
    }
    const draft = {
      name: storageGet(localStorage, "rtc-lib:handle"),
      secret: hashData.secret || "",
      server: serverId,
      customKind,
      customUrl,
    };

    let summary = null;
    let peers = null;
    let pickerAbort = null;
    let connecting = false;
    let lastError = "";

    const dot = document.createElement("span");
    dot.className = "rtc-dot is-down";
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", "Not connected");
    const trayButton = document.createElement("button");
    trayButton.type = "button";
    trayButton.className = "rtc-tray-button";
    trayButton.setAttribute("aria-label", "Edit connection");
    trayButton.setAttribute("title", "Edit connection");
    trayButton.setAttribute("aria-controls", "rtc-dialog");
    trayButton.setAttribute("aria-expanded", "false");
    trayButton.append(trayIcon([
      "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      "m15 5 4 4",
    ]));
    const linkButton = document.createElement("button");
    linkButton.type = "button";
    linkButton.className = "rtc-tray-button";
    linkButton.hidden = true;
    linkButton.setAttribute("aria-label", "Copy link");
    linkButton.setAttribute("title", "Copy link");
    linkButton.append(trayIcon([
      "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
      "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    ]));
    const peersButton = document.createElement("button");
    peersButton.type = "button";
    peersButton.className = "rtc-tray-button";
    peersButton.hidden = true;
    peersButton.setAttribute("aria-label", "Peers");
    peersButton.setAttribute("title", "Peers");
    peersButton.setAttribute("aria-expanded", "false");
    peersButton.setAttribute("aria-controls", "rtc-peer-panel");
    peersButton.append(trayIcon([
      { tag: "path", attrs: { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" } },
      { tag: "circle", attrs: { cx: "9", cy: "7", r: "4" } },
      { tag: "path", attrs: { d: "M22 21v-2a4 4 0 0 0-3-3.87" } },
      { tag: "path", attrs: { d: "M16 3.13a4 4 0 0 1 0 7.75" } },
    ]));
    const peerPanel = document.createElement("div");
    peerPanel.id = "rtc-peer-panel";
    peerPanel.className = "rtc-peer-panel";
    peerPanel.hidden = true;
    peerPanel.setAttribute("role", "region");
    peerPanel.setAttribute("aria-label", "Connected peers");
    const peerEmpty = document.createElement("p");
    peerEmpty.className = "rtc-peer-empty";
    peerEmpty.textContent = "No peers yet";
    const peerList = document.createElement("ul");
    peerPanel.append(peerEmpty, peerList);
    let copyTimer = 0;
    const tray = document.createElement("div");
    tray.className = "rtc-tray";
    tray.append(dot, trayButton, linkButton, peersButton);
    const dock = document.createElement("div");
    dock.className = "rtc-dock";
    dock.append(peerPanel, tray);
    root.append(dock);

    function trayIcon(parts) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      for (const part of parts) {
        const shape = typeof part === "string" ? { tag: "path", attrs: { d: part } } : part;
        const node = document.createElementNS("http://www.w3.org/2000/svg", shape.tag);
        for (const [key, value] of Object.entries(shape.attrs)) node.setAttribute(key, value);
        svg.append(node);
      }
      return svg;
    }

    function currentSecret() {
      const field = root.querySelector("input[name=rtc-room-key]");
      return field ? field.value : draft.secret;
    }

    function pageLink() {
      const data = getHashData();
      data.secret = currentSecret();
      data.server = draft.server;
      const preferred = ["secret", "server"];
      if (draft.server === "custom") {
        data.kind = draft.customKind;
        data.url = draft.customUrl.trim();
        preferred.push("kind", "url");
      } else {
        delete data.kind;
        delete data.url;
      }
      const keys = preferred.concat(Object.keys(data).filter((key) => !preferred.includes(key)));
      const hash = keys.map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(data[key] ?? "")).join("&");
      return location.origin + location.pathname + location.search + "#" + hash;
    }

    async function copyPageLink() {
      const link = pageLink();
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        const field = document.createElement("textarea");
        field.value = link;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      linkButton.classList.add("is-copied");
      linkButton.setAttribute("aria-label", "Copied");
      linkButton.setAttribute("title", "Copied");
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        linkButton.classList.remove("is-copied");
        linkButton.setAttribute("aria-label", "Copy link");
        linkButton.setAttribute("title", "Copy link");
      }, 1200);
    }

    function serverDetail(server) {
      return (server.kind === "mqtt" ? "MQTT · " : "WebTorrent tracker · ") + server.url;
    }

    function customDetail() {
      const url = draft.customUrl.trim();
      if (!url) return "MQTT or WebTorrent tracker";
      const kind = draft.customKind === "tracker" ? "WebTorrent tracker" : "MQTT";
      return kind + " · " + url;
    }

    function chosenServer() {
      if (draft.server !== "custom") return SERVERS.find((item) => item.id === draft.server) || null;
      const kind = normalizeKind(draft.customKind);
      const url = parseServerUrl(draft.customUrl);
      if (!kind || !url) return null;
      return { id: "custom", name: url, kind, url };
    }

    function peerLabel(peer) {
      return peer.name || peer.id.slice(0, 6);
    }

    function paintPeerPanel() {
      const list = Rtc.peers();
      peerEmpty.hidden = list.length > 0;
      peerList.replaceChildren();
      for (const peer of list) {
        const item = document.createElement("li");
        item.textContent = peerLabel(peer);
        peerList.append(item);
      }
    }

    function setPeersOpen(next) {
      if (!active) next = false;
      peerPanel.hidden = !next;
      peersButton.setAttribute("aria-expanded", String(next));
      peersButton.classList.toggle("is-open", next);
      if (next) paintPeerPanel();
    }

    function paintPeers() {
      const list = Rtc.peers();
      if (summary) {
        const count = list.length;
        summary.textContent = count === 0
          ? "waiting for peers"
          : count === 1
            ? "1 peer"
            : count + " peers";
        peers.textContent = list.map(peerLabel).join(", ");
      }
      if (!peerPanel.hidden) paintPeerPanel();
    }

    function paintTray() {
      const connected = !!active;
      dot.classList.toggle("is-down", !connected);
      dot.setAttribute("aria-label", connected ? "Connected" : "Not connected");
      linkButton.hidden = !connected;
      peersButton.hidden = !connected;
      if (!connected) setPeersOpen(false);
      trayButton.setAttribute("aria-expanded", String(!!root.querySelector(".rtc-scrim")));
    }

    function destroyDialog() {
      pickerAbort?.abort();
      pickerAbort = null;
      document.querySelectorAll(".rtc-picker-menu").forEach((node) => node.remove());
      root.querySelector(".rtc-scrim")?.remove();
      summary = null;
      peers = null;
    }

    function closeDialog() {
      destroyDialog();
      paintTray();
      trayButton.focus();
    }

    async function startConnect() {
      if (connecting) return;
      const name = draft.name;
      const secret = draft.secret;
      const server = chosenServer();
      if (!server) return;
      connecting = true;
      const connectButton = root.querySelector(".rtc-connect");
      const disconnectButton = root.querySelector(".rtc-disconnect");
      if (connectButton) {
        connectButton.disabled = true;
        connectButton.textContent = "Connecting…";
      }
      if (disconnectButton) disconnectButton.disabled = true;
      if (active) active.stop();
      paintTray();
      try {
        const session = await connect({
          server,
          name,
          secret,
          onPeers: paintPeers,
          onDown(err) {
            lastError = err.message;
            paintTray();
            showForm(err.message);
          },
        });
        active = session;
        storageSet(localStorage, "rtc-lib:handle", name);
        storageSet(localStorage, "rtc-lib:server", server.id);
        if (server.id === "custom") {
          storageSet(localStorage, "rtc-lib:custom-kind", server.kind);
          storageSet(localStorage, "rtc-lib:custom-url", draft.customUrl);
        }
        connecting = false;
        lastError = "";
        const wasOpen = !!root.querySelector(".rtc-scrim");
        destroyDialog();
        paintTray();
        if (wasOpen) trayButton.focus();
      } catch (err) {
        if (active) {
          active.stop();
          active = null;
        }
        connecting = false;
        lastError = err.message || "Could not connect.";
        paintTray();
        showForm(lastError);
      }
    }

    function showForm(errorText) {
      lastError = errorText || "";
      destroyDialog();
      pickerAbort = new AbortController();
      const title = document.createElement("h2");
      title.id = "rtc-title";
      title.textContent = "Connect";
      const lead = document.createElement("p");
      lead.className = "rtc-lead";
      lead.textContent = "Clients that enter the same secret and pick the same server find each other.";

      const nameField = document.createElement("label");
      nameField.className = "rtc-field";
      nameField.append("Handle");
      const nameInput = document.createElement("input");
      nameInput.name = "rtc-handle";
      nameInput.required = true;
      nameInput.maxLength = 40;
      nameInput.autocomplete = "off";
      nameInput.spellcheck = false;
      nameInput.setAttribute("data-1p-ignore", "");
      nameInput.setAttribute("data-lpignore", "true");
      nameInput.setAttribute("data-bwignore", "");
      nameInput.setAttribute("data-protonpass-ignore", "true");
      nameInput.value = draft.name;
      nameInput.addEventListener("input", () => {
        draft.name = nameInput.value;
        storageSet(localStorage, "rtc-lib:handle", nameInput.value);
      });
      nameField.append(nameInput);

      const secretField = document.createElement("label");
      secretField.className = "rtc-field";
      secretField.append("Shared secret");
      const secretInput = document.createElement("input");
      secretInput.name = "rtc-room-key";
      secretInput.required = true;
      secretInput.maxLength = 200;
      secretInput.autocomplete = "off";
      secretInput.spellcheck = false;
      secretInput.setAttribute("data-1p-ignore", "");
      secretInput.setAttribute("data-lpignore", "true");
      secretInput.setAttribute("data-bwignore", "");
      secretInput.setAttribute("data-protonpass-ignore", "true");
      secretInput.value = draft.secret;
      secretInput.addEventListener("input", () => {
        draft.secret = secretInput.value;
      });
      secretField.append(secretInput);

      function mountPicker({ labelText, labelId, menuId, currentId, getId, setId, getChoices }) {
        const field = document.createElement("div");
        field.className = "rtc-field";
        const label = document.createElement("span");
        label.id = labelId;
        label.textContent = labelText;
        const picker = document.createElement("div");
        picker.className = "rtc-picker";
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "rtc-picker-trigger";
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-labelledby", labelId + " " + currentId);
        const triggerValue = document.createElement("span");
        triggerValue.className = "rtc-picker-value";
        const triggerName = document.createElement("strong");
        triggerName.id = currentId;
        const triggerDetail = document.createElement("small");
        triggerValue.append(triggerName, triggerDetail);
        const chevron = document.createElement("span");
        chevron.className = "rtc-picker-chevron";
        chevron.setAttribute("aria-hidden", "true");
        trigger.append(triggerValue, chevron);
        const menu = document.createElement("div");
        menu.className = "rtc-picker-menu";
        menu.hidden = true;
        menu.id = menuId;
        menu.setAttribute("role", "listbox");
        menu.setAttribute("aria-labelledby", labelId);
        trigger.setAttribute("aria-controls", menuId);
        const options = getChoices().map((choice) => {
          const option = document.createElement("button");
          option.type = "button";
          option.className = "rtc-picker-option";
          option.dataset.id = choice.id;
          option.setAttribute("role", "option");
          option.append(document.createElement("strong"), document.createElement("small"));
          option.addEventListener("click", () => {
            setId(choice.id);
            paint();
            setOpen(false);
            trigger.focus();
          });
          menu.append(option);
          return option;
        });
        function paint() {
          const choices = getChoices();
          const selected = choices.find((choice) => choice.id === getId()) || choices[0];
          triggerName.textContent = selected.name;
          triggerDetail.textContent = selected.detail;
          options.forEach((option, index) => {
            const choice = choices[index];
            option.querySelector("strong").textContent = choice.name;
            option.querySelector("small").textContent = choice.detail;
            const isSelected = choice.id === selected.id;
            option.classList.toggle("is-selected", isSelected);
            option.setAttribute("aria-selected", String(isSelected));
          });
        }
        function place() {
          const rect = trigger.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > window.innerHeight) {
            setOpen(false);
            return;
          }
          menu.style.left = rect.left + "px";
          menu.style.width = rect.width + "px";
          const below = rect.bottom + 6;
          menu.style.top = below + "px";
          const height = menu.offsetHeight;
          if (below + height > window.innerHeight - 8) {
            menu.style.top = Math.max(8, rect.top - 6 - height) + "px";
          }
        }
        function setOpen(next) {
          menu.hidden = !next;
          picker.classList.toggle("is-open", next);
          trigger.setAttribute("aria-expanded", String(next));
          if (!next) return;
          place();
          if (menu.hidden) return;
          (options.find((option) => option.dataset.id === getId()) || options[0]).focus();
        }
        trigger.addEventListener("click", () => setOpen(menu.hidden));
        trigger.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
        });
        menu.addEventListener("keydown", (event) => {
          const index = options.indexOf(document.activeElement);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            trigger.focus();
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
          }
          if (event.key === "ArrowDown") options[Math.min(options.length - 1, index + 1)]?.focus();
          if (event.key === "ArrowUp") options[Math.max(0, index - 1)]?.focus();
          if (event.key === "Home") options[0].focus();
          if (event.key === "End") options[options.length - 1].focus();
        });
        picker.addEventListener("focusout", (event) => {
          if (!menu.hidden && !picker.contains(event.relatedTarget) && !menu.contains(event.relatedTarget)) {
            setOpen(false);
          }
        });
        document.body.append(menu);
        picker.append(trigger);
        field.append(label, picker);
        paint();
        const signal = pickerAbort.signal;
        document.addEventListener("mousedown", (event) => {
          if (menu.hidden) return;
          if (picker.contains(event.target) || menu.contains(event.target)) return;
          setOpen(false);
        }, { capture: true, signal });
        window.addEventListener("resize", () => {
          if (!menu.hidden) place();
        }, { signal });
        return { field, menu, paint, place, setOpen };
      }

      const serverPicker = mountPicker({
        labelText: "Server",
        labelId: "rtc-server-label",
        menuId: "rtc-server-list",
        currentId: "rtc-server-current",
        getId: () => draft.server,
        setId(id) {
          draft.server = id;
          storageSet(localStorage, "rtc-lib:server", id);
          paintCustom();
        },
        getChoices: () => SERVERS.map((server) => ({
          id: server.id,
          name: server.name,
          detail: serverDetail(server),
        })).concat([{ id: "custom", name: "Custom", detail: customDetail() }]),
      });
      const typePicker = mountPicker({
        labelText: "Type",
        labelId: "rtc-type-label",
        menuId: "rtc-type-list",
        currentId: "rtc-type-current",
        getId: () => draft.customKind,
        setId(id) {
          draft.customKind = id;
          storageSet(localStorage, "rtc-lib:custom-kind", id);
          serverPicker.paint();
        },
        getChoices: () => [
          { id: "mqtt", name: "MQTT", detail: "MQTT broker" },
          { id: "tracker", name: "Tracker", detail: "WebTorrent tracker" },
        ],
      });
      const urlField = document.createElement("label");
      urlField.className = "rtc-field";
      urlField.append("URL");
      const urlInput = document.createElement("input");
      urlInput.name = "rtc-server-url";
      urlInput.placeholder = "wss://example.com/mqtt";
      urlInput.autocomplete = "off";
      urlInput.spellcheck = false;
      urlInput.setAttribute("data-1p-ignore", "");
      urlInput.setAttribute("data-lpignore", "true");
      urlInput.setAttribute("data-bwignore", "");
      urlInput.setAttribute("data-protonpass-ignore", "true");
      urlInput.value = draft.customUrl;
      urlInput.addEventListener("input", () => {
        draft.customUrl = urlInput.value;
        storageSet(localStorage, "rtc-lib:custom-url", urlInput.value);
        serverPicker.paint();
      });
      urlField.append(urlInput);
      function paintCustom() {
        const custom = draft.server === "custom";
        typePicker.field.hidden = !custom;
        urlField.hidden = !custom;
        if (!custom) typePicker.setOpen(false);
        serverPicker.paint();
      }
      paintCustom();
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !serverPicker.menu.hidden || !typePicker.menu.hidden) return;
        event.preventDefault();
        closeDialog();
      }, { signal: pickerAbort.signal });

      const stun = document.createElement("p");
      stun.className = "rtc-stun";
      stun.textContent = "Peer connections use public STUN: " + STUN.join(", ") + ".";

      const error = document.createElement("p");
      error.className = "rtc-error";
      error.setAttribute("role", "alert");
      error.hidden = !errorText;
      error.textContent = errorText || "";

      const button = document.createElement("button");
      button.type = "submit";
      button.className = "rtc-connect";
      button.textContent = connecting ? "Connecting…" : "Connect";
      button.disabled = connecting;
      const actions = document.createElement("div");
      actions.className = "rtc-actions";
      if (active) {
        const disconnectButton = document.createElement("button");
        disconnectButton.type = "button";
        disconnectButton.className = "rtc-disconnect";
        disconnectButton.textContent = "Disconnect";
        disconnectButton.disabled = connecting;
        disconnectButton.addEventListener("click", () => {
          if (connecting) return;
          active?.stop();
          showForm("");
        });
        actions.append(disconnectButton);
      }
      actions.append(button);

      const scroll = document.createElement("div");
      scroll.className = "rtc-scroll";
      scroll.append(title, lead, nameField, secretField, serverPicker.field, typePicker.field, urlField, stun, error);
      if (active) {
        summary = document.createElement("span");
        summary.className = "rtc-summary";
        peers = document.createElement("span");
        peers.className = "rtc-peers";
        const live = document.createElement("p");
        live.className = "rtc-live";
        live.append(summary, peers);
        scroll.append(live);
        paintPeers();
      }
      scroll.addEventListener("scroll", () => {
        if (!serverPicker.menu.hidden) serverPicker.place();
        if (!typePicker.menu.hidden) typePicker.place();
      }, { signal: pickerAbort.signal });
      const form = document.createElement("form");
      form.autocomplete = "off";
      form.append(scroll, actions);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (connecting || button.disabled) return;
        draft.name = nameInput.value.trim();
        draft.secret = secretInput.value;
        draft.customUrl = urlInput.value;
        if (!draft.name) {
          error.hidden = false;
          error.textContent = "Enter a handle.";
          return;
        }
        if (!draft.secret) {
          error.hidden = false;
          error.textContent = "Enter a shared secret.";
          return;
        }
        if (draft.server === "custom" && !chosenServer()) {
          error.hidden = false;
          error.textContent = "Enter a websocket URL, starting with wss:// or ws://.";
          urlInput.focus();
          return;
        }
        error.hidden = true;
        startConnect();
      });

      const close = document.createElement("button");
      close.type = "button";
      close.className = "rtc-close";
      close.setAttribute("aria-label", "Close");
      close.textContent = "×";
      close.addEventListener("click", () => closeDialog());
      const dialog = document.createElement("div");
      dialog.id = "rtc-dialog";
      dialog.className = "rtc-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "rtc-title");
      dialog.append(close, form);
      const scrim = document.createElement("div");
      scrim.className = "rtc-scrim";
      scrim.append(dialog);
      scrim.addEventListener("mousedown", (event) => {
        if (event.target === scrim) closeDialog();
      });
      root.append(scrim);
      paintTray();
      nameInput.focus();
    }

    trayButton.addEventListener("click", () => {
      if (root.querySelector(".rtc-scrim")) closeDialog();
      else showForm(lastError);
    });
    linkButton.addEventListener("click", () => {
      copyPageLink();
    });
    peersButton.addEventListener("click", () => {
      setPeersOpen(peerPanel.hidden);
    });

    const savedHandle = draft.name.trim();
    const hashServer = serverFromHash(hashData);
    if (savedHandle && hashData.secret && hashServer) {
      draft.name = savedHandle;
      draft.secret = hashData.secret;
      draft.server = hashServer.id;
      if (hashServer.id === "custom") {
        draft.customKind = hashServer.kind;
        draft.customUrl = hashServer.url;
      }
      startConnect();
    } else {
      showForm("");
    }
  }
})();
