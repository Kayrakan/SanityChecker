import { flatRoutes } from "@remix-run/fs-routes";

export { loader as appScenariosIndexLoader, action as appScenariosIndexAction } from "./routes/app.scenarios._index";
export { loader as appScenarioDetailLoader, action as appScenarioDetailAction } from "./routes/app.scenarios.$id";
export { loader as appRunsIndexLoader } from "./routes/app.runs._index";
export { loader as appRunDetailLoader, action as appRunDetailAction } from "./routes/app.runs.$id";
export { loader as appSettingsIndexLoader, action as appSettingsIndexAction } from "./routes/app.settings._index";
export { loader as internalCronLoader } from "./routes/internal.cron";
export { loader as internalQueueDrainLoader } from "./routes/internal.queue.drain";
export { loader as internalDigestLoader } from "./routes/internal.digest";
export { loader as internalMarketInfoLoader } from "./routes/internal.market-info";
export { loader as internalProvincesLoader } from "./routes/internal.provinces";
export { loader as internalAddressLookupLoader } from "./routes/internal.address-lookup";
export { loader as internalCollectionsLoader } from "./routes/internal.collections";
export { loader as internalFacetsLoader } from "./routes/internal.facets";
export { loader as internalVariantProfilesLoader } from "./routes/internal.variant-profiles";

export default flatRoutes();
