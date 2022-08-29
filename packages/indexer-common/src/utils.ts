export const parseBoolean = (
  val: string | boolean | number | undefined | null,
): boolean => {
  const s = val && val.toString().toLowerCase().trim()
  return s != 'false' && s != 'f' && s != '0'
}

export function nullPassThrough<T, U>(fn: (x: T) => U): (x: T | null) => U | null {
  return (x: T | null) => (x === null ? null : fn(x))
}
