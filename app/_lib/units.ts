// Nimiq amounts travel as Lunas: 1 NIM = 100_000 Luna. The multiplier is
// inlined in several places across the app; route new code through here so a
// stray factor of ten cannot become a hundred-thousand-fold payment error.
export const LUNAS_PER_NIM = 100_000;

export function nimToLunas(nim: number) {
  if (!Number.isFinite(nim) || nim < 0) throw new RangeError(`Invalid NIM amount: ${nim}`);
  return Math.round(nim * LUNAS_PER_NIM);
}

export function lunasToNim(lunas: number) {
  return lunas / LUNAS_PER_NIM;
}

export function formatNim(lunas: number, locale = "en") {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 5 }).format(lunasToNim(lunas));
}

// "NQ" + 2 check digits + 32 base32 characters, conventionally shown in groups
// of four. Base32 here excludes I, O, W and Z.
const NIMIQ_ADDRESS = /^NQ[0-9]{2}(?:[0-9A-HJ-NP-VXY]{4}){8}$/;

export function isValidNimiqAddress(address: string) {
  return NIMIQ_ADDRESS.test(address.replace(/\s/g, "").toUpperCase());
}

export function formatNimiqAddress(address: string) {
  const raw = address.replace(/\s/g, "").toUpperCase();
  return raw.match(/.{1,4}/g)?.join(" ") ?? raw;
}

// Confirmation chips show both ends so a swapped middle is still visible.
export function truncateAddress(address: string, lead = 8, tail = 4) {
  const raw = address.replace(/\s/g, "").toUpperCase();
  if (raw.length <= lead + tail) return formatNimiqAddress(raw);
  return `${raw.slice(0, lead)}…${raw.slice(-tail)}`;
}
