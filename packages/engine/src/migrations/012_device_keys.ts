// LDJ-10: devices that hold the data key. key_proof_hash is a scrypt hash of a one-way value made from the data key
// (keyProof in @somnium/shared), registered while the password is proven; a device that can show it may set a new
// password without the old one. sessions.holds_key is a plain flag the app sets when this sign-in registered a device
// key (Android Keystore), shown in the signed-in devices list. Never a key: the key itself stays on the device.
export default /* sql */ `
ALTER TABLE users ADD COLUMN IF NOT EXISTS key_proof_hash text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS holds_key boolean NOT NULL DEFAULT false;
`;
