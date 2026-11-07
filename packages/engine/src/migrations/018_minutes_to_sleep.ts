// LDJ-64: how many minutes it took to fall asleep after the technique (MILD, SSILD, WBTB ...), the strongest predictor
// in the largest MILD study (asleep within 10 minutes: 18.3% of nights lucid against 11.1%, RESEARCH.md B38), so
// "What works for you" can compare it. Sealed (sealed.ts) like the other personal night facts, so the column is text:
// the device's envelope on the server, whole minutes as text on the device.
export default /* sql */ `
ALTER TABLE nights ADD COLUMN IF NOT EXISTS minutes_to_sleep text;
`;
