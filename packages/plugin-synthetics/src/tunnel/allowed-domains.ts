import {isIP} from 'net'

const WILDCARD_PREFIX = '*.'
const HOSTNAME_PATTERN = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?$/i

const normalizeHost = (host: string) =>
  host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '')

export const getInvalidAllowedDomains = (allowedDomains: string[]): string[] =>
  allowedDomains.filter((domain) => {
    const normalized = normalizeHost(domain)
    const base = normalized.startsWith(WILDCARD_PREFIX) ? normalized.slice(WILDCARD_PREFIX.length) : normalized

    return !base || /[*/\s]/.test(base)
  })

export const isAllowedHost = (host: string, allowedDomains: string[]): boolean => {
  // DNS lookups stop at a NUL byte, so `127.0.0.1\0.example.com` would match `*.example.com` and reach 127.0.0.1.
  if (!isIP(host) && !HOSTNAME_PATTERN.test(host)) {
    return false
  }

  const normalizedHost = normalizeHost(host)

  return allowedDomains.some((domain) => {
    const normalizedDomain = normalizeHost(domain)
    if (normalizedDomain.startsWith(WILDCARD_PREFIX)) {
      return normalizedHost.endsWith(normalizedDomain.slice(1))
    }

    return normalizedHost === normalizedDomain
  })
}
