export const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const gm = (n: number) => (n >= 10 ? fmt(n, 1) : fmt(n, n >= 1 ? 1 : 2));

export const crates = (c: Record<number, number>) =>
  Object.entries(c)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([size, n]) => `${n}×${size}`)
    .join(" · ");

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
