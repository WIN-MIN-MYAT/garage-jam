const value = (object, key) => object?.[key] ?? null;
const delta = (now, before, key) => now?.[key] == null || before?.[key] == null ? null : now[key] - before[key];
const averageMs = (seconds, count) => seconds == null || !count ? null : Math.round(seconds * 1000 / count * 10) / 10;
export const show = (value, unit = '') => value == null || !Number.isFinite(value) ? 'n/a' : `${Math.round(value * 10) / 10}${unit}`;

export async function collectStats(peer, previous, role) {
  const report = await peer.getStats();
  const media = [...report.values()].find(item => item.type === (role === 'sender' ? 'outbound-rtp' : 'inbound-rtp') && (item.kind === 'video' || item.mediaType === 'video'));
  const old = media && previous?.get(media.id);
  const transport = [...report.values()].find(item => item.type === 'transport' && item.selectedCandidatePairId);
  const pair = report.get(transport?.selectedCandidatePairId) || [...report.values()].find(item => item.type === 'candidate-pair' && (item.selected || item.nominated && item.state === 'succeeded'));
  const local = report.get(pair?.localCandidateId), remote = report.get(pair?.remoteCandidateId);
  const elapsed = old ? (media.timestamp - old.timestamp) / 1000 : null;
  const bytes = delta(media, old, role === 'sender' ? 'bytesSent' : 'bytesReceived');
  const bitrate = bytes != null && elapsed > 0 ? Math.round(bytes * 8 / elapsed / 1000) : null;
  const common = {
    width: value(media, 'frameWidth'), height: value(media, 'frameHeight'), fps: value(media, 'framesPerSecond'), bitrateKbps: bitrate,
    localType: value(local, 'candidateType'), remoteType: value(remote, 'candidateType'), protocol: value(local, 'protocol') || value(remote, 'protocol'),
    rttMs: pair?.currentRoundTripTime == null ? null : Math.round(pair.currentRoundTripTime * 1000),
    availableKbps: pair?.availableOutgoingBitrate == null ? null : Math.round(pair.availableOutgoingBitrate / 1000),
  };
  const data = role === 'sender' ? {
    ...common,
    implementation: value(media, 'encoderImplementation'), efficient: value(media, 'powerEfficientEncoder'),
    encodeMs: averageMs(delta(media, old, 'totalEncodeTime'), delta(media, old, 'framesEncoded')),
    sendDelayMs: averageMs(delta(media, old, 'totalPacketSendDelay'), delta(media, old, 'packetsSent')),
    frames: value(media, 'framesEncoded'), targetKbps: media?.targetBitrate == null ? null : Math.round(media.targetBitrate / 1000),
    packets: value(media, 'packetsSent'),
    quality: value(media, 'qualityLimitationReason'), qualityDurations: value(media, 'qualityLimitationDurations'),
    nack: value(media, 'nackCount'), pli: value(media, 'pliCount'), fir: value(media, 'firCount'),
    retransmits: value(media, 'retransmittedPacketsSent'), keyFrames: value(media, 'keyFramesEncoded'),
  } : {
    ...common,
    implementation: value(media, 'decoderImplementation'), efficient: value(media, 'powerEfficientDecoder'),
    decodeMs: averageMs(delta(media, old, 'totalDecodeTime'), delta(media, old, 'framesDecoded')),
    jitterBufferMs: averageMs(delta(media, old, 'jitterBufferDelay'), delta(media, old, 'jitterBufferEmittedCount')),
    jitterMs: media?.jitter == null ? null : Math.round(media.jitter * 1000),
    framesReceived: value(media, 'framesReceived'), framesDecoded: value(media, 'framesDecoded'), framesDropped: value(media, 'framesDropped'),
    packets: value(media, 'packetsReceived'), lost: value(media, 'packetsLost'), freezes: value(media, 'freezeCount'),
    freezeDuration: value(media, 'totalFreezesDuration'), pauses: value(media, 'pauseCount'), keyFrames: value(media, 'keyFramesDecoded'),
  };
  return { report, data };
}
