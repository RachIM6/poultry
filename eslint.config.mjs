import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module dependencies from CAPABILITY-MAP.md. A module may import another
// module only through its index, and only if it is listed here.
const moduleDeps = {
  identity: [],
  "reference-data": [],
  notifications: ["identity"],
  "farm-registry": ["identity"],
  "market-prices": ["identity", "reference-data"],
  "partner-access": ["identity", "farm-registry"],
  documents: ["farm-registry", "notifications"],
  inventory: ["farm-registry", "reference-data", "notifications"],
  flock: ["farm-registry", "reference-data", "inventory", "notifications"],
  health: ["flock", "inventory", "reference-data", "partner-access", "notifications"],
  climate: ["flock", "notifications"],
  biosecurity: ["farm-registry", "flock", "notifications"],
  eggs: ["flock", "inventory"],
  planning: ["flock", "market-prices", "notifications"],
  workforce: ["identity", "farm-registry", "flock", "health", "notifications"],
  sales: ["flock", "health", "eggs"],
  finance: ["farm-registry", "inventory", "flock", "sales", "workforce"],
  reporting: ["flock", "health", "biosecurity", "documents", "sales", "finance"],
};

const deepImport = (self) => ({
  regex: `^@/modules/(?!${self}/)[^/]+/(?!index$).+`,
  message: "Import other modules only through their index (@/modules/<id>).",
});

const boundaryPatterns = (id, deps) => [
  deepImport(id),
  {
    regex: `^@/modules/(?!(${[id, ...deps].join("|")})(/|$))[^/]+`,
    message: `'${id}' may only depend on: ${deps.join(", ") || "nothing"} (CAPABILITY-MAP.md).`,
  },
  {
    regex: "^\\.\\./",
    message: "Use @/modules/<id>/... instead of parent-relative imports inside modules.",
  },
];

// domain/ is pure and isomorphic: it runs on the server and in the offline client (poultry-ddd skill).
const purityPatterns = (id) => [
  {
    regex: "^(next|react|react-dom|server-only|@prisma/client)(/|$)|^node:|^(fs|path|crypto|os|http|https|net|stream|util|child_process)$",
    message: "domain/ must stay pure: no framework, Prisma or Node imports.",
  },
  { regex: "^@/lib/(?!kernel(/|$))", message: "domain/ may only use @/lib/kernel from src/lib." },
  { regex: `^@/modules/${id}/(application|infrastructure)(/|$)`, message: "domain/ must not depend on application/ or infrastructure/." },
];

// Two configs per module: flat config replaces (not merges) a rule's options, so domain/ repeats the boundary patterns.
const moduleBoundaries = Object.entries(moduleDeps).flatMap(([id, deps]) => [
  {
    files: [`src/modules/${id}/**`],
    rules: { "no-restricted-imports": ["error", { patterns: boundaryPatterns(id, deps) }] },
  },
  {
    files: [`src/modules/${id}/domain/**`],
    rules: { "no-restricted-imports": ["error", { patterns: [...boundaryPatterns(id, deps), ...purityPatterns(id)] }] },
  },
]);

// Business code reads time through the Clock (farm days in Africa/Casablanca), never the system clock directly.
const noSystemClock = {
  files: ["src/modules/*/domain/**", "src/modules/*/application/**"],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Use the injected Clock, not new Date()." },
      { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "Use the injected Clock, not Date.now()." },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Code outside modules (app, offline) uses module indexes only; lib is shared infra and must not depend on modules.
  {
    files: ["src/**"],
    ignores: ["src/modules/**", "src/lib/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [deepImport("$^")] }] },
  },
  {
    files: ["src/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: "^@/modules/", message: "src/lib must not depend on domain modules." }] },
      ],
    },
  },
  ...moduleBoundaries,
  noSystemClock,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
