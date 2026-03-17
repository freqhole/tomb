// client method coverage validation - compile-time route safety
//
// purpose: ensure every generated route has a corresponding typed method in FreqholeClient
//
// what this tests:
// - every route in codegen/routes.ts has a method in client.app/auth/music
// - naming convention consistency (snake_case routes -> camelCase methods)
//
// runs at compile time - no server or API_KEY needed
// helps catch missing methods when new routes are added to the server
import { routes } from "../codegen/routes.js";
import { createHttpClient } from "../FreqholeClient.js";

// create a client to inspect its methods
const client = createHttpClient("http://localhost:8080");

// map of domain -> client namespace
const clientDomains = {
  admin: client.admin,
  app: client.app,
  auth: client.auth,
  music: client.music,
};

// convert route names to expected method names (snake_case -> camelCase)
function toMethodName(routeName: string): string {
  return routeName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// convert method names back to route names (camelCase -> snake_case)
function toRouteName(methodName: string): string {
  return methodName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export async function validateWrapperCoverage() {
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  console.log("validating client method coverage...\n");

  // check each route has a client method
  for (const [domain, domainRoutes] of Object.entries(routes)) {
    const clientNamespace = clientDomains[domain as keyof typeof clientDomains];

    if (!clientNamespace) {
      errors.push(`✗ no client namespace for domain '${domain}'`);
      failed++;
      continue;
    }

    for (const routeName of Object.keys(domainRoutes)) {
      const expectedMethodName = toMethodName(routeName);

      if (!(expectedMethodName in clientNamespace)) {
        errors.push(
          `✗ ${domain}.${routeName}: missing client method '${expectedMethodName}' in client.${domain}`,
        );
        failed++;
      } else {
        console.log(`✓ client method exists for ${domain}.${routeName}`);
        passed++;
      }
    }
  }

  // check for extra methods (methods without routes)
  for (const [domain, clientNamespace] of Object.entries(clientDomains)) {
    const domainRoutes = routes[domain as keyof typeof routes];

    if (!domainRoutes) {
      errors.push(`✗ client domain '${domain}' has no routes`);
      failed++;
      continue;
    }

    const methodNames = Object.keys(clientNamespace).filter(
      (key) => typeof (clientNamespace as any)[key] === "function",
    );

    for (const methodName of methodNames) {
      const routeName = toRouteName(methodName);

      if (!(routeName in domainRoutes)) {
        errors.push(
          `✗ client.${domain}.${methodName}: method has no corresponding route '${routeName}'`,
        );
        failed++;
      } else {
        console.log(`✓ route exists for client.${domain}.${methodName}`);
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
