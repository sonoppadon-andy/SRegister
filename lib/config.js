export function env(name, fallback) {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable: ${name}`);
}
export const appName = () => env('APP_NAME', 'ระบบข้อมูลกรมธรรม์');
