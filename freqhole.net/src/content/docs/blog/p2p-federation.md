---
title: P2P federation
date: 2026-03-03T22:22:22Z
authors:
  - edward
excerpt: share your music library with frenz using peer-to-peer connectionz
tags:
  - feature
  - p2p
---

ohey! freqhole now has p2p music sharing via the very cool [iroh](https://iroh.computer) rust crate. 👏

## pee-two ...what?

running yr own http server is kinda of a pain:

- configure TLS certificates
- set up port forwarding on your router
- deal with dynamic IP changes
- set up a VPN or tailscale, or wireguard

instead of fighting with browser CORS, cookiez, port forwarding, and dynamic DNS; share music using peer-to-peer connectionz! eee-zee-pee-zee!

the iroh p2p stuff sidestepz all of that and "just works"™️

## technical bits

under the hood, iroh handles:

- **NAT traversal**: connections work through most home networks
- **relay fallback**: if direct connection fails, data routes through iroh's relay infrastructure (e.g. when using browser WASM module)
- **QUIC transport**: modern protocol, encrypted, handles packet loss well

relay nodes only see connection metadata — actual message streamz are encrypted end-to-end.
