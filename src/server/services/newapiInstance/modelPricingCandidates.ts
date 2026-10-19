/**
 * Return a model id followed by the safe canonical variants used by pricing
 * catalogs. Providers commonly append dated snapshots or serving variants to
 * an otherwise stable model id; only those explicit suffixes are stripped.
 */
const MODEL_VARIANT_SUFFIX_REGEX =
  /-(?:\d{8}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|00\d|thinking|fast|beta|latest|preview|fp8)$/i;

export const getModelPricingCandidates = (model: string): string[] => {
  const candidates: string[] = [];
  let current = model.trim();

  while (current && !candidates.includes(current)) {
    candidates.push(current);
    const canonical = current.replace(MODEL_VARIANT_SUFFIX_REGEX, '');
    if (canonical === current) break;
    current = canonical;
  }

  return candidates;
};
