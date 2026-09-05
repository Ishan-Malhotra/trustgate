import type { UserPolicy } from "@/lib/types";
import { USER_POLICY, mergeUserPolicy } from "./userPolicy";

const globalForPolicy = globalThis as unknown as {
  runtimeUserPolicy?: UserPolicy;
};

export function getUserPolicy(): UserPolicy {
  return globalForPolicy.runtimeUserPolicy ?? USER_POLICY;
}

export function setUserPolicy(policy: Partial<UserPolicy>): UserPolicy {
  globalForPolicy.runtimeUserPolicy = mergeUserPolicy(policy);
  return globalForPolicy.runtimeUserPolicy;
}

export function resetUserPolicy(): UserPolicy {
  globalForPolicy.runtimeUserPolicy = { ...USER_POLICY };
  return globalForPolicy.runtimeUserPolicy;
}
