// Streak dates mix local and UTC bases; they agree only in UTC (CI, Railway).
// jest copies process.env per test file, so TZ has to be set here, not in a spec.
export default function setUtc(): void {
  process.env.TZ = 'UTC';
}
