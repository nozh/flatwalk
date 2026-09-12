const ROOMS_DECLARED: Record<string, number> = {
  garsonjera: 0.5,
  jednosoban: 1,
  jednoiposoban: 1.5,
  dvosoban: 2,
  dvoiposoban: 2.5,
  trosoban: 3,
  troiposoban: 3.5,
  cetvorosoban: 4,
  cetvoroiposoban: 4.5,
};

function foldLabel(label: string): string {
  return label
    .replace(/[#*_`~]/g, " ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function roomsDeclaredFromLabel(label?: string): number | undefined {
  if (!label) return undefined;
  const folded = foldLabel(label);
  if (!folded) return undefined;
  for (const [word, value] of Object.entries(ROOMS_DECLARED)) {
    if (new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(folded)) return value;
  }
  return undefined;
}
