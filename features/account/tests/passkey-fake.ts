// WebAuthn 시험 도우미. 플러그인과 @simplewebauthn/server의 실제 검증 경로를 그대로 지나가도록
// 진짜 P-256 키쌍과 최소 CBOR 인코더로 등록·인증 응답을 만든다. 시험 전용이며 운영 코드에서 쓰지 않는다.
import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";

type CborValue = number | string | Buffer | Map<number | string, CborValue>;

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  throw new Error("시험 CBOR: 지원하지 않는 크기");
}

function cbor(v: CborValue): Buffer {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") {
    const b = Buffer.from(v, "utf8");
    return Buffer.concat([head(3, b.length), b]);
  }
  const parts: Buffer[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

export interface FakeAuthenticator {
  credentialId: Buffer;
  privateKey: KeyObject;
  coseKey: Buffer;
  signCount: number;
}

export function createFakeAuthenticator(): FakeAuthenticator {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const coseKey = cbor(
    new Map<number, CborValue>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ]),
  );
  return { credentialId: randomBytes(16), privateKey, coseKey, signCount: 0 };
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest();

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

/** 등록 응답 (navigator.credentials.create 결과의 JSON 형태). flags: UP|UV|AT */
export function registrationResponse(
  auth: FakeAuthenticator,
  opts: { challenge: string; origin: string; rpId: string },
) {
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(auth.credentialId.length);
  const authData = Buffer.concat([
    sha256(opts.rpId),
    Buffer.from([0x45]),
    u32(0),
    Buffer.alloc(16),
    credIdLen,
    auth.credentialId,
    auth.coseKey,
  ]);
  const attestationObject = cbor(
    new Map<string, CborValue>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authData],
    ]),
  );
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge: opts.challenge,
      origin: opts.origin,
      crossOrigin: false,
    }),
  );
  const id = auth.credentialId.toString("base64url");
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: clientDataJSON.toString("base64url"),
      attestationObject: attestationObject.toString("base64url"),
      transports: ["internal"],
    },
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
  };
}

/** 인증 응답 (navigator.credentials.get 결과). 서명 카운터는 호출마다 올린다. flags: UP|UV */
export function authenticationResponse(
  auth: FakeAuthenticator,
  opts: { challenge: string; origin: string; rpId: string },
) {
  auth.signCount += 1;
  const authenticatorData = Buffer.concat([
    sha256(opts.rpId),
    Buffer.from([0x05]),
    u32(auth.signCount),
  ]);
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: opts.challenge,
      origin: opts.origin,
      crossOrigin: false,
    }),
  );
  const signature = sign(
    "sha256",
    Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
    auth.privateKey,
  );
  const id = auth.credentialId.toString("base64url");
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: clientDataJSON.toString("base64url"),
      authenticatorData: authenticatorData.toString("base64url"),
      signature: signature.toString("base64url"),
    },
    clientExtensionResults: {},
  };
}
