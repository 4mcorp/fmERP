"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Department, Member } from "@/lib/types";

export type TargetValue = { type: "member" | "department"; id: string };

/** `member:ID` / `department:ID` 형태의 선택 값 */
const encode = (t: TargetValue) => `${t.type}:${t.id}`;
const decode = (v: string): TargetValue => {
  const [type, ...rest] = v.split(":");
  return { type: type === "department" ? "department" : "member", id: rest.join(":") };
};

/** 구성원 또는 부서를 하나 고른다. 고르는 즉시 `onPick`이 불리고 선택은 비워진다 */
export function TargetSelect({
  id,
  label,
  members,
  departments,
  allowMembers = true,
  exclude = [],
  onPick,
}: {
  id: string;
  label: string;
  members: Member[];
  departments: Department[];
  allowMembers?: boolean;
  /** 이미 고른 대상 (목록에서 뺀다) */
  exclude?: TargetValue[];
  onPick: (target: TargetValue, name: string) => void;
}) {
  const taken = new Set(exclude.map(encode));
  const memberOptions = allowMembers
    ? members.filter((m) => m.status === "active" && !taken.has(`member:${m.membershipId}`))
    : [];
  const departmentOptions = departments.filter((d) => !taken.has(`department:${d.id}`));
  return (
    <Select
      // 고른 뒤 비우려고 값을 고정한다
      value=""
      onValueChange={(v) => {
        const target = decode(v);
        const name =
          target.type === "member"
            ? (members.find((m) => m.membershipId === target.id)?.name ?? "")
            : (departments.find((d) => d.id === target.id)?.name ?? "");
        onPick(target, name);
      }}
    >
      <SelectTrigger id={id} aria-label={label} className="w-full sm:w-64">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {memberOptions.length > 0 && (
          <SelectGroup>
            <SelectLabel>구성원</SelectLabel>
            {memberOptions.map((m) => (
              <SelectItem key={m.membershipId} value={`member:${m.membershipId}`}>
                {m.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {departmentOptions.length > 0 && (
          <SelectGroup>
            <SelectLabel>부서</SelectLabel>
            {departmentOptions.map((d) => (
              <SelectItem key={d.id} value={`department:${d.id}`}>
                {d.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
