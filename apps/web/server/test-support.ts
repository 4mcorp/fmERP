// 통합 테스트 설정: 합성한 앱과 완료 패키지 생성기를 공통 시험 도우미에 주입한다. 앱 코드에서 import하지 않는다.
import { generatePackage } from "@fmerp/feature-completion/jobs/jobs";
import { setPackageGenerator } from "@fmerp/shared/testing/package-generator";
import { setTestApp } from "@fmerp/shared/testing/test-client";
import { app } from "./app";

setTestApp(app);
setPackageGenerator(generatePackage);
