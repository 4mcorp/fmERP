// 기능 지도 정합성 (계획 5.2의 3): 지도에 적힌 파일·화면·시험이 실제로 있는지, 코드에 있는 화면·어댑터가 지도에 빠지지 않았는지,
// 생성 색인(docs/feature-map)이 최신인지. 위반은 0건이어야 한다.
import fs from "node:fs";
import path from "node:path";
import { buildIndex, canonicalJson, indexJson, indexMarkdown, validate } from "../feature-map";
import { ROOT } from "../root";
import type { Gate } from "./types";

export const featureMapGate: Gate = {
  name: "feature-map",
  description:
    "feature.map.yaml 정합성(파일·화면·어댑터·표 선언)과 docs/feature-map 색인 최신 여부",
  async collect() {
    const index = buildIndex(ROOT);
    const keys = validate(ROOT, index);
    const read = (f: string) => {
      const p = path.join(ROOT, "docs", "feature-map", f);
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    };
    const json = read("index.json");
    if (json === null || canonicalJson(json) !== canonicalJson(indexJson(index)))
      keys.push("stale-index:index.json");
    if (read("INDEX.md") !== indexMarkdown(index)) keys.push("stale-index:INDEX.md");
    return keys;
  },
};
