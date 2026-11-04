import { ENTITY_LOGOS, resolveEntity } from "./entities";

test("built-in pages retain their logos for existing entities", () => {
  expect(resolveEntity("dps", [{ code: "DPS", logo: null }]).logo).toBe(ENTITY_LOGOS.dps);
  expect(resolveEntity("pgos", [{ code: "Pallavi", logo: null }]).logo).toBe(ENTITY_LOGOS.pgos);
});

test("configured logos are used on built-in and newly created pages", () => {
  expect(resolveEntity("pgos", [{ code: "Pallavi", logo: "dps" }]).logo).toBe(ENTITY_LOGOS.dps);
  expect(resolveEntity("new-school", [{ code: "new-school", name: "New School", logo: "pgos" }]).logo).toBe(ENTITY_LOGOS.pgos);
  expect(resolveEntity("dps", [{ code: "DPS", logo: "none" }]).logo).toBeNull();
});
