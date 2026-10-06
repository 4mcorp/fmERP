// pnpm arch:boundaries — biome.boundaries.json을 features/*에서 다시 만든다 (사람이 직접 고치지 않는다)
import fs from "node:fs";
import { BOUNDARIES_FILE, expectedBoundaries } from "../boundaries";

fs.writeFileSync(BOUNDARIES_FILE, expectedBoundaries());
console.log("biome.boundaries.json 갱신");
