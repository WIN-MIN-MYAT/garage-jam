export function isUdpCandidate(candidate) {
  const value = typeof candidate === 'string' ? candidate : candidate?.candidate;
  return typeof value === 'string' && /^candidate:\S+\s+\d+\s+udp\s+/i.test(value);
}
export function udpOnlyDescription(description) {
  return {
    type: description.type,
    sdp: description.sdp.split(/\r?\n/).filter(line => !/^a=candidate:/i.test(line) || isUdpCandidate(line.slice(2))).join('\r\n'),
  };
}
