export function pick<T extends object, K extends keyof T> (base: T, keys: K[]): Pick<T, K> {
  const entries = keys
    .filter(key => !!base[key])
    .map(key => ([key, base[key]]));

  return Object.fromEntries(entries);
}
