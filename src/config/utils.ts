export function getEnvOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`[Config Error] Missing env: ${key}`);
  return v;
}
