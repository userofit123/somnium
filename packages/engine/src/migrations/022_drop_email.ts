// LDJ-145: the optional email is gone. The server sends no mail and nothing read it, so it only collected personal
// data, unsealed, for no purpose ("private from the start"). Dropping the column also drops its column grants (002,
// 005). Old backups still restore: an export's "user" carries who owned the rows, and its email, if any, is ignored.
export default /* sql */ `
ALTER TABLE users DROP COLUMN IF EXISTS email;
`;
