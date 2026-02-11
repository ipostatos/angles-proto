export function cryptoRandomId() {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(16).slice(2)}`;
  } catch {
    return `id_${Math.random().toString(16).slice(2)}`;
  }
}

export const DEFAULT_HOLDS = [
  "Anton", "Austin", "Amon", "Asteca", "Avalon", "Avalon Flat", "Avalon SuperFlat",
  "Base 10", "Base 15", "Base Zero", "Boomerang", "Chava", "Circo", "Classica",
  "Concord", "Crack", "Crack Midle", "Crack ending 30", "Crack ending 45",
  "Cuneo", "Cuneo Lungo", "Delta", "Etna", "Flat 80", "Flat 90", "Fratelli",
  "French fries", "Fresco 10", "Fresco 20", "Fresco 30", "Fuji", "Gamma 3",
  "Gamma 3 (Large)", "Gamma 4", "Gamma 4 (30)", "Gamma 4 (Large)",
  "Gamma 4 (40)", "Gobba", "Gradino", "Half Chava", "Half Circo", "Half Lancia",
  "Inca", "Katla", "Lancia", "Lancia Flat", "Leon", "Lipari", "Mago (Large)",
  "Mago - set A", "Mago - set B", 'Mago medium "A"', 'Mago medium "B"',
  "Parapetto 60", "Parapetto 70", "Parapetto 80", "Rampa", "Rampa wide",
  "Rumba High", "Rumba Low", "Salina", "Samba", "Sparo", "Sparo Super Flat",
  "Sparo Flat", "Splash", "Square", "Square Flat", "Square SuperFlat",
  "Tufa", "Ustica", "WI-FI 70", "WI-FI 80",
];

export const DEFAULT_ANGLES = [
  { id: cryptoRandomId(), hold: "Austin", value: 28.2, saw: "main" },
  { id: cryptoRandomId(), hold: "Avalon Flat", value: 65.0, saw: "main" },
  { id: cryptoRandomId(), hold: "Austin", value: 65.3, saw: "main" },
  { id: cryptoRandomId(), hold: "Avalon SuperFlat", value: 30.0, saw: "stefan" },
  { id: cryptoRandomId(), hold: "Amon", value: 50.0, saw: "stefan" },
];

export const ADMIN_HASH_KEY = "angles_proto_v1_admin_hash";
