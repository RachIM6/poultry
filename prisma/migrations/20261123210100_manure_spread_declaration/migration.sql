-- SPEC-m2-compliance CQ4 (decided default, to review, 2026-11-23).
-- CQ4: manure spread only more than 500 m from any poultry farm or hatchery, or composted (décret n° 2-04-684, art. 12;
-- arrêté n° 2127-05, art. 4). Removals recorded before carry no declaration.
ALTER TABLE "ManureRemoval" ADD COLUMN "spreadDeclared" BOOLEAN NOT NULL DEFAULT false;
