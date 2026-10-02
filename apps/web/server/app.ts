import { pingDatabase } from "@fmerp/db";
import { createApp } from "./create-app";
import { getDatabase } from "./db";

export const app = createApp({
  pingDatabase: () => pingDatabase(getDatabase().pool),
});
