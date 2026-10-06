// 통합 테스트 설정: 합성한 앱을 공통 시험 도우미(loginAs)에 주입한다. 앱 코드에서 import하지 않는다.
import { setTestApp } from "@fmerp/shared/testing/test-client";
import { app } from "./app";

setTestApp(app);
