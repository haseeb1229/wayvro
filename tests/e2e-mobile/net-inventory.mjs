#!/usr/bin/env node
/*
 * Emulator network inventory (U04 open item "runtime network capture of the release build";
 * docs/phase3/PHASE3_SDK_PRIVACY_INVENTORY.md). Node built-ins only; no proxy, no CA, no TLS interception, no app change.
 *
 * Input: a classic libpcap file of the emulator's guest network and the run-flows.mjs summary.json, whose `timestamps`
 * (epoch ms, host clock) split the capture into a pre-install baseline and the app session. Images with virtio-wifi
 * (API 31+, e.g. the API 35 lane) route the guest's traffic over the netsim Wi-Fi medium: capture it with the emulator
 * option `-netsim-args --pcap` (netsimd writes <temp>/netsimd/pcaps/netsim-<n>-<avd>-WIFI.pcap, 802.11 + radiotap,
 * linktype 127, flushed when the emulator exits). `-tcpdump <file>` (Ethernet, linktype 1) records only the emulator's
 * Ethernet/radio NIC, which carries the guest traffic on pre-virtio-wifi images (API 29) but not on virtio-wifi images.
 * Raw-IP linktypes 101/228/229, bare 802.11 (105) and Linux SLL/SLL2 are also read.
 *
 *   node tests/e2e-mobile/net-inventory.mjs --pcap <file.pcap> --summary <run-flows summary.json> --out <dir> [--api-port N]
 *   node tests/e2e-mobile/net-inventory.mjs --self-test     (synthesized pcap fixtures, incl. a negative control)
 *
 * Extracted: DNS query names (UDP/53 and TCP/53) and DNS answers (A/AAAA/CNAME, used to name IP endpoints); TLS
 * ClientHello SNI (port-agnostic: any TCP stream whose client side starts with a TLS handshake record, reassembled over
 * the first 16 KiB); the plaintext HTTP Host header (host only — never paths or bodies); per-server-endpoint packet and
 * byte counts. UDP/443 is reported as "QUIC (SNI not parsed)": decrypting QUIC Initial packets is not attempted.
 *
 * Classification: WAYVRO_SYNTHETIC_API (10.0.2.2:<API port>, the emulator's alias of the host loopback), BASELINE (first
 * seen before the APK install started — OS traffic) or DURING_APP_SESSION_ONLY (first seen after it — candidates for
 * app-originated traffic; the OS, Google Play services and the Maestro driver keep running in that window, and an
 * emulator pcap carries no per-UID attribution). Result: FAIL when an analytics/ads/crash-reporting/update host is
 * DURING_APP_SESSION_ONLY; BLOCKED when the capture cannot support the inventory (no baseline window, no IP packets, no
 * synthetic API traffic seen); PASS otherwise. Every host is listed for human review whatever the result.
 * Outputs <out>/net-inventory.json + net-inventory.md: host names and IP endpoints only, never payload content.
 * Exit code 0 = PASS, 1 = FAIL or BLOCKED, 2 = usage/input error. EMULATOR evidence only — never device evidence.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appUidBytes, packageUid } from './lib/netstats.mjs';
import { fileURLToPath } from 'node:url';

const LABEL = 'EMULATOR NETWORK INVENTORY — release-mode E2E build, synthetic environment; not device evidence; per-app attribution limited';
const ATTRIBUTION =
  'An emulator pcap records every packet of the virtual NIC with no owning UID: traffic first seen during the app session may come from the app, the OS, ' +
  'Google Play services or the Maestro driver. DURING_APP_SESSION_ONLY therefore lists candidates for app-originated traffic, not proven app traffic; ' +
  'BASELINE hosts may also be contacted by the app.';
const EMULATOR_HOST_LOOPBACK = '10.0.2.2';
const STREAM_LIMIT = 16 * 1024;
const MAX_RECORD = 16 * 1024 * 1024;
const say = (line) => process.stdout.write(`${line}\n`);
const sayErr = (line) => process.stderr.write(`${line}\n`);

/** Analytics / ads / crash-reporting / attribution / OTA-update hosts. Matched on whole DNS labels. */
const FLAG_PATTERNS = [
  ['crash reporting', /(^|\.)crashlytics(reports)?\.(com|googleapis\.com)$|(^|\.)firebase-settings\./],
  ['crash reporting', /(^|\.)sentry\.io$|(^|\.)ingest\.(us\.|de\.)?sentry\.io$|(^|\.)sentry-cdn\.com$/],
  ['crash reporting', /(^|\.)bugsnag\.com$|(^|\.)bugsnag\.io$/],
  ['analytics', /(^|\.)app-measurement\.com$/],
  ['analytics', /(^|\.)google-analytics\.com$|(^|\.)analytics\.google\.com$|(^|\.)firebaselogging(-pa)?\.googleapis\.com$/],
  ['analytics', /(^|\.)segment\.(io|com)$/],
  ['analytics', /(^|\.)amplitude\.com$/],
  ['analytics', /(^|\.)mixpanel\.com$/],
  ['ads', /(^|\.)doubleclick\.net$|(^|\.)googleadservices\.com$|(^|\.)googlesyndication\.com$|(^|\.)admob\.com$/],
  ['attribution', /(^|\.)appsflyer(sdk)?\.com$|(^|\.)adjust\.(com|net|io)$|(^|\.)adj\.st$|(^|\.)branch\.io$|(^|\.)app\.link$/],
  ['OTA update / Expo service', /(^|\.)expo\.dev$|(^|\.)expo\.io$|(^|\.)exp\.host$/],
  ['social SDK', /(^|\.)graph\.facebook\.com$|(^|\.)facebook\.com$|(^|\.)facebook\.net$/],
];
const flagOf = (host) => FLAG_PATTERNS.find(([, re]) => re.test(host))?.[0] ?? null;

// ── libpcap ────────────────────────────────────────────────────────────────────────────────────────────────────────
function readPcap(buf) {
  if (buf.length < 24) throw new Error('not a pcap file (shorter than the 24-byte global header)');
  const magics = { a1b2c3d4: false, a1b23c4d: true };
  let le = null;
  let nano = false;
  for (const [hex, isNano] of Object.entries(magics)) {
    const m = Number.parseInt(hex, 16);
    if (buf.readUInt32LE(0) === m) [le, nano] = [true, isNano];
    else if (buf.readUInt32BE(0) === m) [le, nano] = [false, isNano];
  }
  if (le === null) {
    if (buf.readUInt32LE(0) === 0x0a0d0d0a) throw new Error('pcapng is not supported (the emulator writes classic libpcap)');
    throw new Error(`unknown pcap magic 0x${buf.readUInt32BE(0).toString(16)}`);
  }
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const linkType = u32(20) & 0x0fffffff;
  const packets = [];
  let off = 24;
  let truncatedTail = false;
  while (off < buf.length) {
    const incl = off + 16 <= buf.length ? u32(off + 8) : -1;
    if (incl < 0 || incl > MAX_RECORD || off + 16 + incl > buf.length) {
      truncatedTail = true;
      break;
    }
    packets.push({ ts: u32(off) * 1000 + u32(off + 4) / (nano ? 1e6 : 1e3), data: buf.subarray(off + 16, off + 16 + incl) });
    off += 16 + incl;
  }
  return { linkType, byteOrder: le ? 'little-endian' : 'big-endian', resolution: nano ? 'ns' : 'us', packets, truncatedTail };
}

/** Link layer → { ethertype, payload } (0x0800 IPv4, 0x86dd IPv6). */
function linkPayload(linkType, d) {
  const byVersion = (p) => ({ ethertype: p.length && p[0] >> 4 === 6 ? 0x86dd : 0x0800, payload: p });
  if (linkType === 1) {
    if (d.length < 14) return null;
    let type = d.readUInt16BE(12);
    let off = 14;
    while ((type === 0x8100 || type === 0x88a8) && d.length >= off + 4) {
      type = d.readUInt16BE(off + 2);
      off += 4;
    }
    return { ethertype: type, payload: d.subarray(off) };
  }
  if (linkType === 101 || linkType === 12 || linkType === 14) return byVersion(d);
  if (linkType === 228) return { ethertype: 0x0800, payload: d };
  if (linkType === 229) return { ethertype: 0x86dd, payload: d };
  if (linkType === 113 && d.length >= 16) return { ethertype: d.readUInt16BE(14), payload: d.subarray(16) };
  if (linkType === 276 && d.length >= 20) return { ethertype: d.readUInt16BE(0), payload: d.subarray(20) };
  // 802.11 with radiotap (127) or bare (105): the netsim Wi-Fi medium of virtio-wifi emulator images.
  if (linkType === 127) return d.length >= 4 ? ieee80211(d.subarray(d.readUInt16LE(2))) : null;
  if (linkType === 105) return ieee80211(d);
  return null;
}

/** 802.11 data frame → LLC/SNAP payload. Management/control, protected (encrypted), null-data and retry frames: null. */
function ieee80211(f) {
  if (f.length < 24) return null;
  const fc0 = f[0];
  const fc1 = f[1];
  if (((fc0 >> 2) & 0x03) !== 2 || (fc1 & 0x40) !== 0 || (fc1 & 0x08) !== 0) return null;
  const subtype = fc0 >> 4;
  if ((subtype & 0x04) !== 0) return null;
  let off = 24 + ((fc1 & 0x03) === 0x03 ? 6 : 0);
  if ((subtype & 0x08) !== 0) off += 2 + ((fc1 & 0x80) !== 0 ? 4 : 0);
  if (f.length < off + 8 || f[off] !== 0xaa || f[off + 1] !== 0xaa || f[off + 2] !== 0x03) return null;
  return { ethertype: f.readUInt16BE(off + 6), payload: f.subarray(off + 8) };
}

function ipv6Text(b) {
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(b.readUInt16BE(i));
  let best = [-1, 0];
  for (let i = 0; i < 8;) {
    let j = i;
    while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > best[1] && j - i >= 2) best = [i, j - i];
    i = j === i ? i + 1 : j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best[0] < 0) return hex.join(':');
  return `${hex.slice(0, best[0]).join(':')}::${hex.slice(best[0] + best[1]).join(':')}`;
}

/** Network layer → { family, src, dst, proto, bytes, payload } (payload null for non-first fragments). */
function ipPacket(ethertype, p) {
  if (ethertype === 0x0800) {
    if (p.length < 20 || p[0] >> 4 !== 4) return null;
    const ihl = (p[0] & 0x0f) * 4;
    const total = p.readUInt16BE(2) || p.length;
    const fragmentOffset = p.readUInt16BE(6) & 0x1fff;
    return {
      family: 4,
      src: [...p.subarray(12, 16)].join('.'),
      dst: [...p.subarray(16, 20)].join('.'),
      proto: p[9],
      bytes: total,
      payload: fragmentOffset ? null : p.subarray(ihl, Math.min(p.length, total)),
    };
  }
  if (ethertype === 0x86dd) {
    if (p.length < 40 || p[0] >> 4 !== 6) return null;
    const length = p.readUInt16BE(4);
    let next = p[6];
    let off = 40;
    let laterFragment = false;
    while ((next === 0 || next === 43 || next === 44 || next === 60) && p.length >= off + 8) {
      const following = p[off];
      if (next === 44) {
        if ((p.readUInt16BE(off + 2) & 0xfff8) !== 0) laterFragment = true;
        off += 8;
      } else off += (p[off + 1] + 1) * 8;
      next = following;
    }
    return {
      family: 6,
      src: ipv6Text(p.subarray(8, 24)),
      dst: ipv6Text(p.subarray(24, 40)),
      proto: next,
      bytes: 40 + length,
      payload: laterFragment ? null : p.subarray(Math.min(off, p.length), Math.min(p.length, 40 + length)),
    };
  }
  return null;
}

// ── application payloads ───────────────────────────────────────────────────────────────────────────────────────────
function dnsName(msg, start) {
  const labels = [];
  let off = start;
  let end = -1;
  for (let hops = 0; hops < 64 && off < msg.length; hops += 1) {
    const len = msg[off];
    if (len === 0) return { name: labels.join('.').toLowerCase(), next: end < 0 ? off + 1 : end };
    if ((len & 0xc0) === 0xc0) {
      if (off + 1 >= msg.length) return null;
      if (end < 0) end = off + 2;
      off = ((len & 0x3f) << 8) | msg[off + 1];
      continue;
    }
    if (off + 1 + len > msg.length) return null;
    labels.push(msg.toString('latin1', off + 1, off + 1 + len));
    off += 1 + len;
  }
  return null;
}

/** DNS message → { response, questions: [{ name, type }], answers: [{ name, type, value }] } or null. */
function parseDns(msg) {
  if (msg.length < 12) return null;
  const response = (msg[2] & 0x80) !== 0;
  const qd = msg.readUInt16BE(4);
  const an = msg.readUInt16BE(6);
  if (qd > 32 || an > 256) return null;
  let off = 12;
  const questions = [];
  for (let i = 0; i < qd; i += 1) {
    const n = dnsName(msg, off);
    if (!n || n.next + 4 > msg.length) return null;
    questions.push({ name: n.name, type: msg.readUInt16BE(n.next) });
    off = n.next + 4;
  }
  const answers = [];
  for (let i = 0; i < an; i += 1) {
    const n = dnsName(msg, off);
    if (!n || n.next + 10 > msg.length) break;
    const type = msg.readUInt16BE(n.next);
    const rdlen = msg.readUInt16BE(n.next + 8);
    const rd = n.next + 10;
    if (rd + rdlen > msg.length) break;
    if (type === 1 && rdlen === 4) answers.push({ name: n.name, type: 'A', value: [...msg.subarray(rd, rd + 4)].join('.') });
    else if (type === 28 && rdlen === 16) answers.push({ name: n.name, type: 'AAAA', value: ipv6Text(msg.subarray(rd, rd + 16)) });
    else if (type === 5) {
      const target = dnsName(msg, rd);
      if (target) answers.push({ name: n.name, type: 'CNAME', value: target.name });
    }
    off = rd + rdlen;
  }
  return { response, questions, answers };
}

/** TLS ClientHello at the start of a client stream → { sni, alpn, ech } or null. Handles fragmented handshake records. */
function parseClientHello(stream) {
  let h = Buffer.alloc(0);
  let off = 0;
  while (off + 5 <= stream.length && stream[off] === 0x16 && stream[off + 1] === 0x03 && stream[off + 2] <= 0x04) {
    const len = stream.readUInt16BE(off + 3);
    h = Buffer.concat([h, stream.subarray(off + 5, Math.min(stream.length, off + 5 + len))]);
    off += 5 + len;
    if (h.length >= 4 && h.length >= 4 + h.readUIntBE(1, 3)) break;
  }
  if (h.length < 4 || h[0] !== 0x01) return null;
  const body = h.subarray(4, Math.min(h.length, 4 + h.readUIntBE(1, 3)));
  let p = 34;
  if (p + 1 > body.length) return null;
  p += 1 + body[p];
  if (p + 2 > body.length) return null;
  p += 2 + body.readUInt16BE(p);
  if (p + 1 > body.length) return null;
  p += 1 + body[p];
  if (p + 2 > body.length) return { sni: null, alpn: [], ech: false };
  const extEnd = Math.min(body.length, p + 2 + body.readUInt16BE(p));
  p += 2;
  const result = { sni: null, alpn: [], ech: false };
  while (p + 4 <= extEnd) {
    const type = body.readUInt16BE(p);
    const len = body.readUInt16BE(p + 2);
    const ext = body.subarray(p + 4, Math.min(extEnd, p + 4 + len));
    if (type === 0 && ext.length >= 5 && ext[2] === 0) {
      const nameLen = ext.readUInt16BE(3);
      result.sni = ext.toString('latin1', 5, Math.min(ext.length, 5 + nameLen)).toLowerCase();
    } else if (type === 16 && ext.length >= 2) {
      for (let q = 2; q < ext.length;) {
        result.alpn.push(ext.toString('latin1', q + 1, Math.min(ext.length, q + 1 + ext[q])));
        q += 1 + ext[q];
      }
    } else if (type === 0xfe0d) result.ech = true;
    p += 4 + len;
  }
  return result;
}

const HTTP_REQUEST = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S+ HTTP\/1\.[01]\r\n/;
function httpHost(stream) {
  const head = stream.toString('latin1', 0, Math.min(stream.length, 4096));
  if (!HTTP_REQUEST.test(head)) return null;
  const m = /\r\nhost:[ \t]*([^\r\n:]+|\[[^\]]+\])(?::\d+)?\r\n/i.exec(head);
  return m ? m[1].toLowerCase() : null;
}

// ── analysis ───────────────────────────────────────────────────────────────────────────────────────────────────────
const endpointText = (ip, port) => (ip.includes(':') ? `[${ip}]:${String(port)}` : `${ip}:${String(port)}`);

function analyse(pcapBuf, summary, opts = {}) {
  const pcap = readPcap(pcapBuf);
  const t = summary.timestamps ?? {};
  const apiPort = Number(opts.apiPort ?? summary.apiPort ?? 4120);
  const baselineEnd = t.installStartedAt ?? t.flowsStartedAt ?? null;
  const phaseOf = (ts) => {
    if (baselineEnd === null) return 'UNKNOWN';
    if (ts < baselineEnd) return 'BEFORE_INSTALL';
    if (t.flowsStartedAt && ts < t.flowsStartedAt) return 'INSTALL_TO_FLOWS';
    if (!t.flowsEndedAt || ts <= t.flowsEndedAt) return 'FLOWS';
    return 'AFTER_FLOWS';
  };
  const stats = {
    packets: pcap.packets.length,
    ipv4: 0,
    ipv6: 0,
    tcp: 0,
    udp: 0,
    nonIp: 0,
    otherIpProtocols: {},
    unparsedFragments: 0,
    firstTs: null,
    lastTs: null,
  };
  const conns = new Map();
  const hosts = new Map();
  const ipNames = new Map();
  const addHost = (name, source, ts) => {
    if (!name) return;
    const h = hosts.get(name) ?? { host: name, sources: new Set(), firstSeen: ts, count: 0 };
    h.sources.add(source);
    h.firstSeen = Math.min(h.firstSeen, ts);
    h.count += 1;
    hosts.set(name, h);
  };
  const handleDns = (msg, ts, source) => {
    const dns = parseDns(msg);
    if (!dns) return;
    if (!dns.response) for (const q of dns.questions) addHost(q.name, source, ts);
    const aliasOf = new Map();
    for (const a of dns.answers) {
      if (a.type !== 'CNAME') continue;
      addHost(a.value, 'dns-cname', ts);
      aliasOf.set(a.value, a.name);
    }
    for (const a of dns.answers) {
      if (a.type === 'CNAME') continue;
      const names = new Set(ipNames.get(a.value) ?? []);
      for (let n = a.name, hops = 0; n && hops < 16; n = aliasOf.get(n), hops += 1) names.add(n);
      ipNames.set(a.value, names);
    }
  };

  for (const pkt of pcap.packets) {
    stats.firstTs = stats.firstTs === null ? pkt.ts : Math.min(stats.firstTs, pkt.ts);
    stats.lastTs = stats.lastTs === null ? pkt.ts : Math.max(stats.lastTs, pkt.ts);
    const link = linkPayload(pcap.linkType, pkt.data);
    const ip = link ? ipPacket(link.ethertype, link.payload) : null;
    if (!ip) {
      stats.nonIp += 1;
      continue;
    }
    stats[ip.family === 4 ? 'ipv4' : 'ipv6'] += 1;
    if (ip.proto !== 6 && ip.proto !== 17) {
      stats.otherIpProtocols[ip.proto] = (stats.otherIpProtocols[ip.proto] ?? 0) + 1;
      continue;
    }
    const seg = ip.payload;
    if (!seg || seg.length < (ip.proto === 6 ? 20 : 8)) {
      stats.unparsedFragments += 1;
      continue;
    }
    const sport = seg.readUInt16BE(0);
    const dport = seg.readUInt16BE(2);
    const proto = ip.proto === 6 ? 'tcp' : 'udp';
    stats[proto] += 1;
    const flags = proto === 'tcp' ? seg[13] : 0;
    const payload =
      proto === 'tcp' ? seg.subarray(Math.min(seg.length, (seg[12] >> 4) * 4)) : seg.subarray(8, Math.min(seg.length, seg.readUInt16BE(4) || seg.length));
    const a = endpointText(ip.src, sport);
    const b = endpointText(ip.dst, dport);
    const key = `${proto} ${[a, b].sort().join(' ')}`;
    let c = conns.get(key);
    if (!c) {
      const syn = proto === 'tcp' && (flags & 0x02) !== 0;
      // The SYN sender is the client; without a SYN in the capture, the higher (ephemeral) port is the client side.
      const srcIsClient = syn ? (flags & 0x10) === 0 : sport > dport;
      c = {
        proto,
        client: srcIsClient ? { ip: ip.src, port: sport } : { ip: ip.dst, port: dport },
        server: srcIsClient ? { ip: ip.dst, port: dport } : { ip: ip.src, port: sport },
        firstSeen: pkt.ts,
        lastSeen: pkt.ts,
        packets: 0,
        bytesOut: 0,
        bytesIn: 0,
        synSeen: false,
        isn: null,
        segments: new Map(),
      };
      conns.set(key, c);
    }
    const fromClient = ip.src === c.client.ip && sport === c.client.port;
    c.packets += 1;
    c.lastSeen = Math.max(c.lastSeen, pkt.ts);
    c[fromClient ? 'bytesOut' : 'bytesIn'] += ip.bytes;
    if (proto === 'udp') {
      if ((sport === 53 || dport === 53) && payload.length) handleDns(payload, pkt.ts, 'dns');
      continue;
    }
    if (!fromClient) continue;
    const seq = seg.readUInt32BE(4);
    if ((flags & 0x02) !== 0) {
      c.synSeen = true;
      c.isn = (seq + 1) >>> 0;
      continue;
    }
    if (!payload.length) continue;
    if (c.isn === null) c.isn = seq;
    const rel = (seq - c.isn) >>> 0;
    if (rel < STREAM_LIMIT && !c.segments.has(rel)) c.segments.set(rel, { ts: pkt.ts, data: Buffer.from(payload) });
  }

  // Client streams: TLS ClientHello (port-agnostic), DNS over TCP, plaintext HTTP Host.
  for (const c of conns.values()) {
    if (c.proto !== 'tcp' || c.segments.size === 0) continue;
    const parts = [...c.segments.entries()].sort((x, y) => x[0] - y[0]);
    const chunks = [];
    let have = 0;
    let ts = parts[0][1].ts;
    for (const [rel, s] of parts) {
      if (rel > have) break;
      const fresh = s.data.subarray(have - rel);
      if (fresh.length) {
        chunks.push(fresh);
        have += fresh.length;
        ts = Math.max(ts, s.ts);
      }
    }
    const stream = Buffer.concat(chunks);
    c.streamBytesParsed = stream.length;
    const hello = parseClientHello(stream);
    if (hello) {
      c.tls = hello;
      addHost(hello.sni, 'tls-sni', ts);
    } else if (c.server.port === 53) {
      for (let off = 0; off + 2 <= stream.length;) {
        const len = stream.readUInt16BE(off);
        if (len === 0 || off + 2 + len > stream.length) break;
        handleDns(stream.subarray(off + 2, off + 2 + len), ts, 'dns-tcp');
        off += 2 + len;
      }
    } else {
      const host = httpHost(stream);
      if (host) {
        c.httpHost = host;
        if (host !== EMULATOR_HOST_LOOPBACK) addHost(host, 'http-host', ts);
      }
    }
  }

  const categoryAt = (ts) => (baselineEnd === null ? 'UNCLASSIFIED' : ts < baselineEnd ? 'BASELINE' : 'DURING_APP_SESSION_ONLY');
  const endpoints = new Map();
  for (const c of conns.values()) {
    const key = `${c.proto} ${endpointText(c.server.ip, c.server.port)}`;
    const e = endpoints.get(key) ?? {
      proto: c.proto,
      ip: c.server.ip,
      port: c.server.port,
      connections: 0,
      packets: 0,
      bytesOut: 0,
      bytesIn: 0,
      firstSeen: c.firstSeen,
      lastSeen: c.lastSeen,
      sni: new Set(),
      alpn: new Set(),
      httpHost: new Set(),
      ech: false,
    };
    e.connections += 1;
    e.packets += c.packets;
    e.bytesOut += c.bytesOut;
    e.bytesIn += c.bytesIn;
    e.firstSeen = Math.min(e.firstSeen, c.firstSeen);
    e.lastSeen = Math.max(e.lastSeen, c.lastSeen);
    if (c.tls?.sni) e.sni.add(c.tls.sni);
    for (const x of c.tls?.alpn ?? []) e.alpn.add(x);
    if (c.tls?.ech) e.ech = true;
    if (c.httpHost) e.httpHost.add(c.httpHost);
    endpoints.set(key, e);
  }
  const endpointRows = [...endpoints.values()]
    .map((e) => {
      const api = e.proto === 'tcp' && e.ip === EMULATOR_HOST_LOOPBACK && e.port === apiPort;
      const notes = [];
      if (e.proto === 'udp' && e.port === 443) notes.push('QUIC (SNI not parsed)');
      if (e.port === 853) notes.push('DNS-over-TLS (names not visible)');
      if (e.ech) notes.push('ECH extension in ClientHello (GREASE or real; outer SNI shown)');
      if (e.proto === 'tcp' && e.port === 443 && e.sni.size === 0) notes.push('no TLS ClientHello SNI seen (e.g. the connection sent no data)');
      if (e.ip === EMULATOR_HOST_LOOPBACK && !api) notes.push('emulator host loopback, not the synthetic API port');
      return {
        proto: e.proto,
        endpoint: endpointText(e.ip, e.port),
        category: api ? 'WAYVRO_SYNTHETIC_API' : categoryAt(e.firstSeen),
        firstSeenPhase: phaseOf(e.firstSeen),
        firstSeen: new Date(e.firstSeen).toISOString(),
        lastSeen: new Date(e.lastSeen).toISOString(),
        dnsNames: [...(ipNames.get(e.ip) ?? [])].sort(),
        sni: [...e.sni].sort(),
        alpn: [...e.alpn].sort(),
        httpHost: [...e.httpHost].sort(),
        connections: e.connections,
        packets: e.packets,
        bytesOut: e.bytesOut,
        bytesIn: e.bytesIn,
        notes,
      };
    })
    .sort((x, y) => x.category.localeCompare(y.category) || x.firstSeen.localeCompare(y.firstSeen) || x.endpoint.localeCompare(y.endpoint));
  const hostRows = [...hosts.values()]
    .map((h) => ({
      host: h.host,
      category: categoryAt(h.firstSeen),
      firstSeenPhase: phaseOf(h.firstSeen),
      firstSeen: new Date(h.firstSeen).toISOString(),
      sources: [...h.sources].sort(),
      observations: h.count,
      flag: flagOf(h.host),
    }))
    .sort((x, y) => x.category.localeCompare(y.category) || x.firstSeen.localeCompare(y.firstSeen) || x.host.localeCompare(y.host));

  const { firstTs, lastTs, ...counts } = stats;
  const blocked = [];
  if (baselineEnd === null) blocked.push('summary.json has no timestamps.installStartedAt / flowsStartedAt — the baseline window is unknown');
  if (stats.ipv4 + stats.ipv6 === 0) blocked.push('the capture contains no IP packets');
  if (baselineEnd !== null && stats.firstTs !== null && stats.firstTs >= baselineEnd)
    blocked.push('the capture starts after the APK install began — there is no baseline window');
  // The Windows emulator's -tcpdump stamps packets in host local time; a capture whose clock does not reach the run
  // window is not classifiable (on UTC hosts such as CI runners both clocks agree).
  if (baselineEnd !== null && stats.lastTs !== null && stats.lastTs < baselineEnd)
    blocked.push('the capture ends before the APK install began — capture and run clocks do not overlap (time-zone-shifted pcap timestamps?)');
  if (!endpointRows.some((e) => e.category === 'WAYVRO_SYNTHETIC_API'))
    blocked.push(`no traffic to the synthetic API ${EMULATOR_HOST_LOOPBACK}:${String(apiPort)} — the capture did not observe the app session`);
  // Per-app attribution (closure correction §12): the app UID's eBPF byte counters over the flow window, compared with
  // the bytes the capture saw to the synthetic API. When the app's own traffic is accounted for by the synthetic API,
  // hosts first seen during the session are provably not app traffic (OS / Google Play services / Maestro driver).
  const net = summary.appNetwork;
  const apiBytes = endpointRows.filter((e) => e.category === 'WAYVRO_SYNTHETIC_API').reduce((n, e) => n + e.bytesOut + e.bytesIn, 0);
  const appBytes = net && net.after ? net.after.rxBytes + net.after.txBytes - (net.before ? net.before.rxBytes + net.before.txBytes : 0) : null;
  const appTolerance = Math.round(apiBytes * 0.25) + 262_144;
  const attribution =
    appBytes === null
      ? { available: false, reason: 'no app UID counters in summary.json (appNetwork)' }
      : { available: true, uid: net.uid, appBytes, apiBytes, tolerance: appTolerance, accountedFor: appBytes <= apiBytes + appTolerance };
  const flagged = hostRows.filter((h) => h.flag && h.category === 'DURING_APP_SESSION_ONLY');
  const failing = attribution.available && attribution.accountedFor ? [] : flagged;
  const unexplained = attribution.available && !attribution.accountedFor;
  const problems = blocked.length
    ? blocked
    : [
        ...failing.map((h) => `${h.flag} host first seen during the app session: ${h.host}`),
        ...(unexplained
          ? [
              `the app UID ${String(attribution.uid)} exchanged ${String(attribution.appBytes)} B, more than its synthetic-API traffic (${String(attribution.apiBytes)} B + ${String(attribution.tolerance)} B tolerance)`,
            ]
          : []),
      ];
  return {
    label: LABEL,
    attribution: ATTRIBUTION,
    result: blocked.length ? 'BLOCKED' : failing.length || unexplained ? 'FAIL' : 'PASS',
    problems,
    attributionCheck: attribution,
    flaggedNotFromApp: attribution.available && attribution.accountedFor ? flagged.map((h) => h.host) : [],
    capture: {
      linkType: pcap.linkType,
      byteOrder: pcap.byteOrder,
      timestampResolution: pcap.resolution,
      truncatedTail: pcap.truncatedTail,
      firstPacket: firstTs === null ? null : new Date(firstTs).toISOString(),
      lastPacket: lastTs === null ? null : new Date(lastTs).toISOString(),
      ...counts,
    },
    run: { tier: summary.tier ?? null, lane: summary.lane ?? null, apk: summary.apk ?? null, flowsResult: summary.result ?? null, apiPort },
    windows: Object.fromEntries(
      ['installStartedAt', 'installFinishedAt', 'flowsStartedAt', 'flowsEndedAt'].map((k) => [k, t[k] ? new Date(t[k]).toISOString() : null]),
    ),
    flaggedHosts: hostRows.filter((h) => h.flag),
    hosts: hostRows,
    endpoints: endpointRows,
    limitations: [
      ATTRIBUTION,
      'QUIC (UDP/443) Initial packets are not decrypted: their server names are not extracted; DNS queries usually still name the host.',
      'DNS-over-TLS (853) / DNS-over-HTTPS and TLS Encrypted Client Hello hide names; such endpoints are listed by IP only.',
      'The capture point is the guest side of the emulator user-mode NAT (netsim Wi-Fi medium or the -tcpdump NIC); a capture of the wrong medium is caught only by the synthetic-API positive control.',
      'Open (unencrypted) emulator Wi-Fi is assumed for 802.11 captures; protected, management, null-data and retry frames are skipped.',
      'Host clock timestamps: the pcap and run-flows timestamps come from the same host clock; phases are approximate at the boundaries.',
      'Synthetic environment and emulator image (google_apis): Google Play services traffic is OS-side, not a Wayvro SDK.',
    ],
  };
}

function markdown(r) {
  const cell = (v) => String(v).replaceAll('|', '/');
  const lines = [
    `# ${r.label}`,
    '',
    `> ${r.attribution}`,
    '',
    `Result: **${r.result}**${r.problems.length ? '' : ' (no analytics/ads/crash-reporting/update host first seen during the app session)'}`,
    ...r.problems.map((p) => `- ${p}`),
    '',
    `Run: ${cell(r.run.tier)} / ${cell(r.run.lane)} · flows result ${cell(r.run.flowsResult)} · APK ${cell(r.run.apk)} · synthetic API port ${String(r.run.apiPort)}`,
    `Capture: linktype ${String(r.capture.linkType)}, ${r.capture.byteOrder}, ${r.capture.timestampResolution} · ${String(r.capture.packets)} packets (IPv4 ${String(r.capture.ipv4)}, IPv6 ${String(r.capture.ipv6)}, TCP ${String(r.capture.tcp)}, UDP ${String(r.capture.udp)}, non-IP ${String(r.capture.nonIp)}) · ${cell(r.capture.firstPacket)} → ${cell(r.capture.lastPacket)}${r.capture.truncatedTail ? ' · truncated final record ignored' : ''}`,
    `Windows: install ${cell(r.windows.installStartedAt)} → ${cell(r.windows.installFinishedAt)} · flows ${cell(r.windows.flowsStartedAt)} → ${cell(r.windows.flowsEndedAt)}`,
    r.attributionCheck.available
      ? `Per-app attribution (dumpsys netstats, app UID ${String(r.attributionCheck.uid)}): the app exchanged ${String(r.attributionCheck.appBytes)} B; the capture saw ${String(r.attributionCheck.apiBytes)} B to the synthetic API (tolerance ${String(r.attributionCheck.tolerance)} B) → ${r.attributionCheck.accountedFor ? 'the app traffic is accounted for by the synthetic API' : 'UNEXPLAINED app traffic'}${r.flaggedNotFromApp.length ? `; flagged hosts therefore not from the app: ${r.flaggedNotFromApp.join(', ')}` : ''}`
      : `Per-app attribution: not available (${r.attributionCheck.reason})`,
    '',
    '## Flagged hosts (analytics / ads / crash reporting / attribution / OTA update)',
    '',
    ...(r.flaggedHosts.length
      ? [
          '| Host | Flag | Category | First seen (phase) |',
          '|---|---|---|---|',
          ...r.flaggedHosts.map((h) => `| ${h.host} | ${h.flag} | ${h.category} | ${h.firstSeen} (${h.firstSeenPhase}) |`),
        ]
      : ['None.']),
    '',
    '## Hosts (DNS queries, CNAME targets, TLS SNI, HTTP Host)',
    '',
    '| Host | Category | First seen (phase) | Sources | Observations | Flag |',
    '|---|---|---|---|---|---|',
    ...r.hosts.map(
      (h) =>
        `| ${cell(h.host)} | ${h.category} | ${h.firstSeen} (${h.firstSeenPhase}) | ${h.sources.join(', ')} | ${String(h.observations)} | ${h.flag ?? ''} |`,
    ),
    '',
    '## Server endpoints',
    '',
    '| Proto | Endpoint | Category | First seen (phase) | Names (DNS / SNI / Host) | Conns | Packets | Bytes out | Bytes in | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...r.endpoints.map(
      (e) =>
        `| ${e.proto} | ${e.endpoint} | ${e.category} | ${e.firstSeen} (${e.firstSeenPhase}) | ${cell([...new Set([...e.dnsNames, ...e.sni, ...e.httpHost])].join(', '))} | ${String(e.connections)} | ${String(e.packets)} | ${String(e.bytesOut)} | ${String(e.bytesIn)} | ${cell(e.notes.join('; '))} |`,
    ),
    '',
    '## Limitations',
    '',
    ...r.limitations.map((l) => `- ${l}`),
    '',
  ];
  return lines.join('\n');
}

function writeOutputs(report, out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'net-inventory.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(out, 'net-inventory.md'), markdown(report));
}

// ── self-test fixtures ─────────────────────────────────────────────────────────────────────────────────────────────
function pcapFile(records, { linkType = 1, bigEndian = false, nano = false } = {}) {
  const u32 = (v) => {
    const b = Buffer.alloc(4);
    if (bigEndian) b.writeUInt32BE(v >>> 0);
    else b.writeUInt32LE(v >>> 0);
    return b;
  };
  const u16 = (v) => {
    const b = Buffer.alloc(2);
    if (bigEndian) b.writeUInt16BE(v);
    else b.writeUInt16LE(v);
    return b;
  };
  const parts = [u32(nano ? 0xa1b23c4d : 0xa1b2c3d4), u16(2), u16(4), u32(0), u32(0), u32(262144), u32(linkType)];
  for (const { ts, frame } of records) {
    const sec = Math.floor(ts / 1000);
    const frac = Math.round((ts - sec * 1000) * (nano ? 1e6 : 1e3));
    parts.push(u32(sec), u32(frac), u32(frame.length), u32(frame.length), frame);
  }
  return Buffer.concat(parts);
}
const be16 = (v) => Buffer.from([v >> 8, v & 0xff]);
const be32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0);
  return b;
};
function ip6Bytes(text) {
  const [head, tail] = text.split('::');
  const h = head ? head.split(':') : [];
  const tl = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(8 - h.length - tl.length).fill('0'), ...tl];
  return Buffer.concat(groups.map((g) => be16(Number.parseInt(g, 16))));
}
const ip4Bytes = (text) => Buffer.from(text.split('.').map(Number));
const ether = (type, payload) => Buffer.concat([Buffer.from('525400123456525400123457', 'hex'), be16(type), payload]);
/** Minimal radiotap header (version 0, length 8, no fields) and an 802.11 QoS data frame (To-DS) with LLC/SNAP. */
const radiotap = Buffer.from([0, 0, 8, 0, 0, 0, 0, 0]);
const wifi = (type, payload, fc1 = 0x01) =>
  Buffer.concat([radiotap, Buffer.from([0x88, fc1, 0, 0]), Buffer.alloc(18, 2), be16(0), be16(0), Buffer.from([0xaa, 0xaa, 3, 0, 0, 0]), be16(type), payload]);
function ipFrame(src, dst, proto, l4) {
  if (src.includes(':'))
    return {
      ethertype: 0x86dd,
      packet: Buffer.concat([be32(0x60000000), be16(l4.length), Buffer.from([proto, 64]), ip6Bytes(src), ip6Bytes(dst), l4]),
    };
  const h = Buffer.concat([
    Buffer.from([0x45, 0]),
    be16(20 + l4.length),
    be16(0),
    be16(0x4000),
    Buffer.from([64, proto]),
    be16(0),
    ip4Bytes(src),
    ip4Bytes(dst),
  ]);
  return { ethertype: 0x0800, packet: Buffer.concat([h, l4]) };
}
const udpSeg = (sp, dp, payload) => Buffer.concat([be16(sp), be16(dp), be16(8 + payload.length), be16(0), payload]);
const tcpSeg = (sp, dp, seq, flags, payload = Buffer.alloc(0)) =>
  Buffer.concat([be16(sp), be16(dp), be32(seq), be32(0), Buffer.from([0x50, flags]), be16(65535), be16(0), be16(0), payload]);
const qname = (name) => Buffer.concat([...name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'latin1')])), Buffer.from([0])]);
const dnsQuery = (id, name) => Buffer.concat([be16(id), be16(0x0100), be16(1), be16(0), be16(0), be16(0), qname(name), be16(1), be16(1)]);
const dnsAnswer = (id, name, cname, ip) =>
  Buffer.concat([
    be16(id),
    be16(0x8180),
    be16(1),
    be16(2),
    be16(0),
    be16(0),
    qname(name),
    be16(1),
    be16(1),
    be16(0xc00c),
    be16(5),
    be16(1),
    be32(60),
    be16(qname(cname).length),
    qname(cname),
    qname(cname),
    be16(1),
    be16(1),
    be32(60),
    be16(4),
    ip4Bytes(ip),
  ]);
function clientHello(sni) {
  const host = Buffer.from(sni, 'latin1');
  const sniExt = Buffer.concat([be16(0), be16(host.length + 5), be16(host.length + 3), Buffer.from([0]), be16(host.length), host]);
  const alpnList = Buffer.concat([Buffer.from([2]), Buffer.from('h2'), Buffer.from([8]), Buffer.from('http/1.1')]);
  const alpnExt = Buffer.concat([be16(16), be16(alpnList.length + 2), be16(alpnList.length), alpnList]);
  const padding = Buffer.concat([be16(21), be16(600), Buffer.alloc(600)]);
  const exts = Buffer.concat([alpnExt, padding, sniExt]);
  const body = Buffer.concat([be16(0x0303), Buffer.alloc(32, 7), Buffer.from([0]), be16(2), be16(0x1301), Buffer.from([1, 0]), be16(exts.length), exts]);
  const hs = Buffer.concat([Buffer.from([1, 0]), be16(body.length), body]);
  return Buffer.concat([Buffer.from([0x16, 0x03, 0x01]), be16(hs.length), hs]);
}

function selfTest() {
  const T0 = 1_760_000_000_000;
  const G = '10.0.2.15';
  const G6 = 'fec0::15';
  const summary = {
    tier: 'full',
    lane: 'self-test',
    apk: 'wayvro-e2e.apk',
    result: 'PASS',
    apiPort: 4120,
    timestamps: { installStartedAt: T0 + 10_000, installFinishedAt: T0 + 20_000, flowsStartedAt: T0 + 30_000, flowsEndedAt: T0 + 90_000 },
  };
  const pkt = (ts, src, dst, proto, l4) => ({ ts, ...ipFrame(src, dst, proto, l4) });
  const hello6 = clientHello('tiles.example.org');
  const base = [
    pkt(T0 + 1000, G, '10.0.2.3', 17, udpSeg(40001, 53, dnsQuery(1, 'connectivitycheck.gstatic.com'))),
    pkt(T0 + 1010, '10.0.2.3', G, 17, udpSeg(53, 40001, dnsAnswer(1, 'connectivitycheck.gstatic.com', 'www3.l.google.com', '142.250.1.1'))),
    pkt(T0 + 1020, G, '142.250.1.1', 6, tcpSeg(41000, 443, 1000, 0x02)),
    pkt(T0 + 1025, '142.250.1.1', G, 6, tcpSeg(443, 41000, 5000, 0x12)),
    pkt(T0 + 1030, G, '142.250.1.1', 6, tcpSeg(41000, 443, 1001, 0x18, clientHello('connectivitycheck.gstatic.com'))),
    pkt(T0 + 31_000, G, '10.0.2.2', 6, tcpSeg(42000, 4120, 70, 0x02)),
    pkt(T0 + 31_010, G, '10.0.2.2', 6, tcpSeg(42000, 4120, 71, 0x18, Buffer.from('POST /v1/auth/otp HTTP/1.1\r\nHost: 10.0.2.2:4120\r\n\r\n'))),
    // IPv6 TLS ClientHello split over two segments, delivered out of order.
    pkt(T0 + 32_000, G6, '2001:db8::1', 6, tcpSeg(43000, 443, 9, 0x02)),
    pkt(T0 + 32_005, G6, '2001:db8::1', 6, tcpSeg(43000, 443, 10 + 300, 0x18, hello6.subarray(300))),
    pkt(T0 + 32_010, G6, '2001:db8::1', 6, tcpSeg(43000, 443, 10, 0x10, hello6.subarray(0, 300))),
    pkt(T0 + 33_000, G, '142.250.1.2', 17, udpSeg(44000, 443, Buffer.from([0xc0, 0, 0, 0, 1, 8, 1, 2, 3, 4, 5, 6, 7, 8]))),
    // DNS over TCP (length-prefixed) without a SYN in the capture.
    pkt(
      T0 + 34_000,
      G,
      '10.0.2.3',
      6,
      tcpSeg(45000, 53, 500, 0x18, Buffer.concat([be16(dnsQuery(2, 'tiles.example.org').length), dnsQuery(2, 'tiles.example.org')])),
    ),
  ];
  const arp = { ts: T0 + 35_000, frame: ether(0x0806, Buffer.alloc(28)) };
  const eth = (list) => [...list.map((p) => ({ ts: p.ts, frame: ether(p.ethertype, p.packet) })), arp].sort((a, b) => a.ts - b.ts);
  const crash = pkt(T0 + 40_000, G, '10.0.2.3', 17, udpSeg(40002, 53, dnsQuery(3, 'settings.crashlytics.com')));
  const measurementBaseline = pkt(T0 + 2000, G, '10.0.2.3', 17, udpSeg(40003, 53, dnsQuery(4, 'app-measurement.com')));
  const noApi = base.filter((p) => !(p.ts >= T0 + 31_000 && p.ts < T0 + 32_000));
  const lateOnly = base.filter((p) => p.ts >= summary.timestamps.installStartedAt);
  const full = pcapFile(eth(base));
  const host = (r, name) => r.hosts.find((h) => h.host === name);
  const ep = (r, text) => r.endpoints.find((e) => e.endpoint === text);
  const sameInventory = (r) =>
    r.result === 'PASS' && host(r, 'tiles.example.org')?.category === 'DURING_APP_SESSION_ONLY' && ep(r, '10.0.2.2:4120')?.category === 'WAYVRO_SYNTHETIC_API';
  const cases = [
    {
      name: 'Ethernet LE/us: DNS, SNI, IPv6, synthetic API, QUIC, DNS over TCP',
      pcap: full,
      expect: (r) =>
        r.result === 'PASS' &&
        r.capture.linkType === 1 &&
        r.capture.ipv6 === 3 &&
        r.capture.nonIp === 1 &&
        host(r, 'connectivitycheck.gstatic.com')?.category === 'BASELINE' &&
        host(r, 'connectivitycheck.gstatic.com')?.sources.join() === 'dns,tls-sni' &&
        host(r, 'www3.l.google.com')?.sources.join() === 'dns-cname' &&
        host(r, 'tiles.example.org')?.category === 'DURING_APP_SESSION_ONLY' &&
        host(r, 'tiles.example.org')?.sources.join() === 'dns-tcp,tls-sni' &&
        host(r, 'tiles.example.org')?.firstSeenPhase === 'FLOWS' &&
        ep(r, '142.250.1.1:443')?.category === 'BASELINE' &&
        ep(r, '142.250.1.1:443')?.dnsNames.join() === 'connectivitycheck.gstatic.com,www3.l.google.com' &&
        ep(r, '142.250.1.1:443')?.alpn.join() === 'h2,http/1.1' &&
        ep(r, '142.250.1.1:443')?.connections === 1 &&
        ep(r, '142.250.1.1:443')?.packets === 3 &&
        ep(r, '[2001:db8::1]:443')?.sni.join() === 'tiles.example.org' &&
        ep(r, '10.0.2.2:4120')?.category === 'WAYVRO_SYNTHETIC_API' &&
        ep(r, '10.0.2.2:4120')?.httpHost.join() === '10.0.2.2' &&
        ep(r, '142.250.1.2:443')?.notes.includes('QUIC (SNI not parsed)') &&
        r.flaggedHosts.length === 0,
    },
    {
      name: 'NEGATIVE CONTROL: crashlytics host during the app session fails the run',
      pcap: pcapFile(eth([...base, crash])),
      expect: (r) => r.result === 'FAIL' && r.flaggedHosts.some((h) => h.host === 'settings.crashlytics.com' && h.category === 'DURING_APP_SESSION_ONLY'),
    },
    {
      name: 'attribution: a flagged host during the session is NOT the app when the app UID traffic is the synthetic API',
      pcap: pcapFile(eth([...base, crash])),
      summary: { ...summary, appNetwork: { uid: 10150, before: { rxBytes: 0, txBytes: 0 }, after: { rxBytes: 600, txBytes: 400 } } },
      expect: (r) => r.result === 'PASS' && r.attributionCheck.accountedFor === true && r.flaggedNotFromApp.includes('settings.crashlytics.com'),
    },
    {
      name: 'NEGATIVE CONTROL: attribution — app UID traffic far beyond the synthetic API keeps the flagged host failing',
      pcap: pcapFile(eth([...base, crash])),
      summary: { ...summary, appNetwork: { uid: 10150, before: null, after: { rxBytes: 9_000_000, txBytes: 1_000_000 } } },
      expect: (r) => r.result === 'FAIL' && r.attributionCheck.accountedFor === false && r.flaggedNotFromApp.length === 0,
    },
    {
      name: 'NEGATIVE CONTROL: unexplained app UID traffic fails even without a flagged host',
      pcap: full,
      summary: { ...summary, appNetwork: { uid: 10150, before: { rxBytes: 0, txBytes: 0 }, after: { rxBytes: 5_000_000, txBytes: 0 } } },
      expect: (r) => r.result === 'FAIL' && r.problems.some((x) => x.includes('more than its synthetic-API traffic')),
    },
    {
      name: 'flagged host in the OS baseline only is listed, not failed',
      pcap: pcapFile(eth([...base, measurementBaseline])),
      expect: (r) => r.result === 'PASS' && r.flaggedHosts.length === 1 && r.flaggedHosts[0].category === 'BASELINE',
    },
    { name: 'big-endian, nanosecond pcap reads the same', pcap: pcapFile(eth(base), { bigEndian: true, nano: true }), expect: sameInventory },
    {
      name: 'linktype 101 (raw IP) reads the same',
      pcap: pcapFile(
        base.map((p) => ({ ts: p.ts, frame: p.packet })),
        { linkType: 101 },
      ),
      expect: sameInventory,
    },
    {
      name: 'linktype 127 (radiotap + 802.11 QoS data, netsim Wi-Fi) reads the same; beacon and protected frames skipped',
      pcap: pcapFile(
        [
          { ts: T0 + 500, frame: Buffer.concat([radiotap, Buffer.from([0x80, 0x00]), Buffer.alloc(34)]) },
          { ts: T0 + 600, frame: wifi(0x0800, base[0].packet, 0x41) },
          ...base.map((p) => ({ ts: p.ts, frame: wifi(p.ethertype, p.packet) })),
        ],
        { linkType: 127 },
      ),
      expect: (r) => sameInventory(r) && r.capture.nonIp === 2 && host(r, 'connectivitycheck.gstatic.com')?.observations === 2,
    },
    {
      name: 'truncated final record is ignored, earlier packets kept',
      pcap: full.subarray(0, full.length - 5),
      expect: (r) => r.capture.truncatedTail && sameInventory(r),
    },
    { name: 'no synthetic API traffic → BLOCKED', pcap: pcapFile(eth(noApi)), expect: (r) => r.result === 'BLOCKED' },
    { name: 'capture without a baseline window → BLOCKED', pcap: pcapFile(eth(lateOnly)), expect: (r) => r.result === 'BLOCKED' },
    {
      name: 'capture clock 5 h behind the run (local-time pcap) → BLOCKED',
      pcap: pcapFile(base.map((p) => ({ ts: p.ts - 5 * 3600 * 1000, frame: ether(p.ethertype, p.packet) }))),
      expect: (r) => r.result === 'BLOCKED' && r.problems.some((p) => p.includes('clocks do not overlap')),
    },
    {
      name: 'summary without timestamps → BLOCKED',
      pcap: full,
      summary: { lane: 'x' },
      expect: (r) => r.result === 'BLOCKED' && r.hosts.every((h) => h.category === 'UNCLASSIFIED'),
    },
  ];
  const work = mkdtempSync(join(tmpdir(), 'wayvro-net-inventory-'));
  let failed = 0;
  // dumpsys netstats parser (lib/netstats.mjs): the eBPF per-UID map, and the UID lookup.
  const dump = [
    'Dev:',
    '  ...',
    'mAppUidStatsMap:',
    'uid rxBytes rxPackets txBytes txPackets',
    '10149 5 1 6 1',
    '10150 1200 9 800 7',
    '',
    'mUidCounterSetMap:',
  ].join('\r\n');
  const parserOk =
    JSON.stringify(appUidBytes(dump, 10150)) === JSON.stringify({ rxBytes: 1200, txBytes: 800 }) &&
    appUidBytes(dump, 10999) === null &&
    appUidBytes('no such section', 10150) === null &&
    packageUid('package:dev.wayvro.app uid:10150\r\n', 'dev.wayvro.app') === 10150 &&
    packageUid('package:dev.wayvroXapp uid:1', 'dev.wayvro.app') === null;
  if (!parserOk) failed += 1;
  say(`${parserOk ? 'ok  ' : 'FAIL'} dumpsys netstats per-UID parser and package UID lookup`);
  try {
    for (const [i, c] of cases.entries()) {
      const file = join(work, `case-${String(i)}.pcap`);
      writeFileSync(file, c.pcap);
      let ok = false;
      let detail = '';
      try {
        const r = analyse(readFileSync(file), c.summary ?? summary);
        ok = c.expect(r);
        detail = `${r.result}; hosts ${r.hosts.map((h) => `${h.host}=${h.category}`).join(', ')}`;
      } catch (e) {
        detail = `threw ${e instanceof Error ? e.message : String(e)}`;
      }
      if (!ok) failed += 1;
      say(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${detail}`);
    }
    const outDir = join(work, 'out');
    writeOutputs(analyse(full, summary), outDir);
    const md = readFileSync(join(outDir, 'net-inventory.md'), 'utf8');
    const json = JSON.parse(readFileSync(join(outDir, 'net-inventory.json'), 'utf8'));
    const outputsOk = md.startsWith(`# ${LABEL}`) && json.label === LABEL && json.result === 'PASS' && !md.includes('/v1/auth/otp');
    if (!outputsOk) failed += 1;
    say(`${outputsOk ? 'ok  ' : 'FAIL'} outputs carry the label and no payload content (request path absent)`);
    let rejected = false;
    try {
      readPcap(Buffer.concat([be32(0x0a0d0d0a), Buffer.alloc(28)]));
    } catch {
      rejected = true;
    }
    if (!rejected) failed += 1;
    say(`${rejected ? 'ok  ' : 'FAIL'} pcapng input is rejected with an error`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  say(`NET-INVENTORY SELF-TEST: ${failed === 0 ? 'PASS' : 'FAIL'} (${String(cases.length + 2)} cases)`);
  return failed === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--self-test') process.exit(selfTest() ? 0 : 1);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '') ?? ''] = argv[i + 1];
  if (!args.pcap || !args.summary || !args.out) {
    sayErr('usage: --pcap <file.pcap> --summary <run-flows summary.json> --out <dir> [--api-port N] | --self-test');
    process.exit(2);
  }
  let report;
  try {
    report = analyse(readFileSync(args.pcap), JSON.parse(readFileSync(args.summary, 'utf8')), { apiPort: args['api-port'] });
  } catch (e) {
    sayErr(`net-inventory: cannot read the inputs: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  writeOutputs(report, args.out);
  const during = report.hosts.filter((h) => h.category === 'DURING_APP_SESSION_ONLY');
  say(LABEL);
  say(
    `packets ${String(report.capture.packets)}; hosts ${String(report.hosts.length)} (${String(during.length)} first seen during the app session); endpoints ${String(report.endpoints.length)}`,
  );
  for (const h of during) say(`  session-only: ${h.host}${h.flag ? ` [${h.flag}]` : ''}`);
  say(`NET-INVENTORY: ${report.result}`);
  for (const p of report.problems) say(`  - ${p}`);
  process.exit(report.result === 'PASS' ? 0 : 1);
}
