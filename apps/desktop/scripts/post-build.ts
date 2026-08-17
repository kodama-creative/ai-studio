import { verifyCurrentBunDiBundle } from "./verify-bun-di-bundle";

// Verify the JavaScript that will actually ship, then apply the existing
// platform-specific signing workaround. Both failures must stop the build.
verifyCurrentBunDiBundle();
await import("./fix-x64-headerpad");
