// Regional companies available for public signup. Never accept arbitrary organization IDs from signup.
export const REGIONS = Object.freeze({
  sao_paulo: 'São Paulo', rio_de_janeiro: 'Rio de Janeiro', brasilia: 'Brasília',
  curitiba: 'Curitiba', estados_unidos: 'Estados Unidos', dubai: 'Dubai',
});
export const REGION_CODES = Object.keys(REGIONS);
const norm = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Existing branches may have been created before the region column existed.
export function matchesLegacyRegion(name, region) {
  if (!Object.hasOwn(REGIONS, region)) return false;
  const actual = norm(name), label = norm(REGIONS[region]);
  return actual === label || actual.endsWith(` ${label}`);
}
