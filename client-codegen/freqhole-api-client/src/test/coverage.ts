// wrapper coverage validation - ensures all routes have typed wrappers
import { routes } from "../codegen/routes.js";
import * as music from "../music.js";
import * as auth from "../auth.js";
import * as app from "../app.js";

// map of domain -> wrapper functions
const wrappers = {
  app: Object.keys(app),
  auth: Object.keys(auth),
  music: Object.keys(music),
};

// convert route names to expected function names (snake_case -> camelCase)
function toFunctionName(routeName: string): string {
  return routeName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// convert function names back to route names (camelCase -> snake_case)
function toRouteName(fnName: string): string {
  return fnName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export async function validateWrapperCoverage() {
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  console.log("validating wrapper coverage...\n");

  // check each route has a wrapper
  for (const [domain, domainRoutes] of Object.entries(routes)) {
    for (const routeName of Object.keys(domainRoutes)) {
      const expectedFnName = toFunctionName(routeName);
      const domainWrappers = wrappers[domain as keyof typeof wrappers];

      if (!domainWrappers) {
        errors.push(`✗ ${domain}.${routeName}: no wrapper module for domain '${domain}'`);
        failed++;
        continue;
      }

      if (!domainWrappers.includes(expectedFnName)) {
        errors.push(
          `✗ ${domain}.${routeName}: missing wrapper function '${expectedFnName}' in ${domain}.ts`,
        );
        failed++;
      } else {
        console.log(`✓ wrapper exists for ${domain}.${routeName}`);
        passed++;
      }
    }
  }

  // check for extra wrappers (wrappers without routes)
  for (const [domain, domainWrappers] of Object.entries(wrappers)) {
    const domainRoutes = routes[domain as keyof typeof routes];

    if (!domainRoutes) {
      errors.push(`✗ wrapper domain '${domain}' has no routes`);
      failed++;
      continue;
    }

    for (const wrapperFn of domainWrappers) {
      const routeName = toRouteName(wrapperFn);

      if (!(routeName in domainRoutes)) {
        errors.push(
          `✗ ${domain}.${wrapperFn}: wrapper function has no corresponding route '${routeName}'`,
        );
        failed++;
      } else {
        console.log(`✓ route exists for wrapper ${domain}.${wrapperFn}`);
        passed++;
      }
    }
  }

  // print errors at the end for visibility
  if (errors.length > 0) {
    console.log("\nerrors found:\n");
    errors.forEach((err) => console.log(err));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);

  return { passed, failed };
}
