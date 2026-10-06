// DB 덤프의 age 암호화·복호화 (M7). 서버에는 공개키(recipient)만 있고 개인키(identity)는 운영자가 서버 밖에 보관한다.
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from "age-encryption";

/** 공개키(`age1…`) 목록으로 스트림을 암호화한다. 받는 사람이 하나도 없으면 오류 */
export async function encryptStream(source: Readable, recipients: string[]): Promise<Readable> {
  if (recipients.length === 0) throw new Error("암호화할 공개키(BACKUP_AGE_RECIPIENTS)가 없습니다");
  const enc = new Encrypter();
  for (const r of recipients) enc.addRecipient(r);
  const encrypted = await enc.encrypt(Readable.toWeb(source) as ReadableStream<Uint8Array>);
  return Readable.fromWeb(encrypted as unknown as NodeWebStream);
}

/** 개인키(`AGE-SECRET-KEY-1…`)로 스트림을 복호화한다. 키가 맞지 않으면 읽는 순간 오류가 난다 */
export async function decryptStream(source: Readable, identity: string): Promise<Readable> {
  const dec = new Decrypter();
  dec.addIdentity(identity.trim());
  const decrypted = await dec.decrypt(Readable.toWeb(source) as ReadableStream<Uint8Array>);
  return Readable.fromWeb(decrypted as unknown as NodeWebStream);
}

/** 테스트·운영 준비용 키 쌍. 개인키는 저장소·로그에 남기지 않는다 */
export async function generateKeyPair(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}
