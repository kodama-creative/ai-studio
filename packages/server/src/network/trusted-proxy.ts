import { isIP } from "node:net";

export function assertValidTrustedProxyRanges(ranges: readonly string[]): void {
  for (const range of ranges) {
    _matchesRange("127.0.0.1", range);
  }
}

export function isTrustedProxyAddress(
  address: string,
  ranges: readonly string[]
): boolean {
  const normalized = address.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
  return ranges.some(range => _matchesRange(normalized, range));
}

function _matchesRange(address: string, range: string): boolean {
  if (!range.includes("/")) {
    if (isIP(range) === 0) {
      throw new TypeError("Trusted proxy ranges must be IP addresses or CIDRs");
    }
    return address === range;
  }
  const [network, prefixText] = range.split("/");
  if (!network || !prefixText || !/^\d+$/.test(prefixText)) {
    throw new TypeError("Trusted proxy ranges must be IP addresses or CIDRs");
  }
  const prefix = Number(prefixText);
  const addressValue = _ipv4(address);
  const networkValue = _ipv4(network);
  if (addressValue === null || networkValue === null || prefix < 0 || prefix > 32) {
    throw new TypeError("Trusted proxy CIDRs must be valid IPv4 ranges");
  }
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (addressValue & mask) === (networkValue & mask);
}

function _ipv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let output = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const byte = Number(part);
    if (byte > 255) {
      return null;
    }
    output = ((output << 8) | byte) >>> 0;
  }
  return output;
}
