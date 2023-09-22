import * as ipaddr from 'ipaddr.js'

// Taken from https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml
// and https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml",
export const RESERVED_ADDRESS_BLOCKS: {[ipType in IpFamily]: string[]} = {
  4: [
    '0.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.0.0.0/24',
    '192.0.0.0/29',
    '192.0.0.8/32',
    '192.0.0.9/32',
    '192.0.0.10/32',
    '192.0.0.170/32',
    '192.0.0.171/32',
    '192.0.2.0/24',
    '192.31.196.0/24',
    '192.52.193.0/24',
    '192.88.99.0/24',
    '192.168.0.0/16',
    '192.175.48.0/24',
    '198.18.0.0/15',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '240.0.0.0/4',
    '224.0.0.0/4',
    '255.255.255.255/32',
  ],
  6: [
    '::1/128',
    '::/128',
    '::ffff:0:0/96',
    '64:ff9b::/96',
    '64:ff9b:1::/48',
    '100::/64',
    '2001::/23',
    '2001::/32',
    '2001:1::1/128',
    '2001:1::2/128',
    '2001:2::/48',
    '2001:3::/32',
    '2001:4:112::/48',
    '2001:5::/32',
    '2001:10::/28',
    '2001:20::/28',
    '2001:db8::/32',
    '2002::/16',
    '2620:4f:8000::/48',
    'fc00::/7',
    'fe80::/10',
  ],
}

export enum IpFamily {
  v4 = 4,
  v6 = 6,
}

export type IpFamilyType = IpFamily

export const hasValidRanges = (firewallRanges: typeof RESERVED_ADDRESS_BLOCKS) =>
  [IpFamily.v4, IpFamily.v6].every((family) =>
    (firewallRanges[family] || []).every((ipRange) => {
      if (ipaddr.isValid(ipRange)) {
        return true
      } else {
        try {
          ipaddr.parseCIDR(ipRange)

          return true
        } catch (error) {
          return false
        }
      }
    })
  )
