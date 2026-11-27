import { randomInt } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { addFarmDays } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { claimInvitation, inviteMember, setPassword } from "@/modules/identity";
import { must, today } from "../kit";

// The long history's members (ADR-015: email and password): a manager, a worker, the vet and the accountant, each
// with a password made here and written only to a local file, never printed.

export const MEMBERS = [
  { email: "gerant@emsi.ma", role: "manager", label: "Gérant", firstName: "Hamid", lastName: "Ouazzani", company: false, phone: true },
  { email: "ouvrier@emsi.ma", role: "worker", label: "Ouvrier", firstName: "Brahim", lastName: "Aït Lahcen", company: false, phone: true },
  { email: "veterinaire@emsi.ma", role: "vet", label: "Vétérinaire", firstName: "Nadia", lastName: "Berrada", company: false, phone: false },
  { email: "comptable@emsi.ma", role: "accountant", label: "Comptable", firstName: "Karim", lastName: "Tazi", company: true, phone: false },
] as const;
export const MEMBER_EMAILS: readonly string[] = MEMBERS.map((m) => m.email);
export const VET_NAME = "Dr Nadia Berrada";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!#%+=?@";
/** 16 characters from a CSPRNG, at least one of each kind, shuffled. */
export function newPassword() {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const pick = (s: string) => s[randomInt(s.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS), ...Array.from({ length: 12 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

type Line = { email: string; role: string; name: string; password: string };
const readFile = (file: string) =>
  new Map(
    (existsSync(file) ? readFileSync(file, "utf8").split("\n") : [])
      .filter((l) => l.includes("\t") && !l.startsWith("#"))
      .map((l) => l.split("\t"))
      .map(([email, role, name, password]) => [email, { email, role, name, password }] as const),
  );

export type Joined = { manager: TenantContext; worker: TenantContext; vet: TenantContext; accountant: string; phones: { manager: string; worker: string } };

/**
 * The four members: created when missing (their password set as at sign-up, Better Auth's scrypt), kept with their
 * password on a second run unless `rotate`; each joins its organisations through an invitation and its code, as a
 * person invited by phone does at sign-up. `phones`: free made-up numbers for the manager and the worker, so the
 * employees they are link to them (WF2). The file gets one line per member: email, role, name, password.
 */
export async function joinMembers(farm: TenantContext, company: TenantContext, o: { file: string; rotate: boolean; phones: string[] }): Promise<Joined & { file: string; created: number; rotated: number }> {
  const known = readFile(o.file);
  const lines: Line[] = [];
  const ids: Record<string, string> = {};
  const phones: Record<string, string> = {};
  let created = 0;
  let rotated = 0;
  const free = [...o.phones];
  for (const m of MEMBERS) {
    const name = `${m.firstName} ${m.lastName}`;
    let user = await db.user.findUnique({ where: { email: m.email } });
    let password = known.get(m.email)?.password ?? "";
    if (!user) {
      user = await db.user.create({ data: { email: m.email, phoneNumber: m.phone ? free.shift() : null, firstName: m.firstName, lastName: m.lastName, name, locale: "fr" } });
      password = newPassword();
      must(`${m.email} password`, await setPassword(user.id, password));
      created++;
    } else if (o.rotate || !password) {
      password = newPassword();
      must(`${m.email} password`, await setPassword(user.id, password));
      rotated++;
    }
    if (m.phone && !user.phoneNumber) user = await db.user.update({ where: { id: user.id }, data: { phoneNumber: free.shift() } });
    ids[m.role] = user.id;
    if (user.phoneNumber) phones[m.role] = user.phoneNumber;
    for (const org of m.company ? [farm, company] : [farm]) {
      if (await db.membership.findUnique({ where: { organizationId_userId: { organizationId: org.organizationId, userId: user.id } } })) continue;
      const accessUntil = m.role === "vet" ? addFarmDays(today, 365) : null;
      const { code } = must(`${m.email} invitation`, await inviteMember(org, { phone: free.shift(), role: m.role, accessUntil })).value;
      must(`${m.email} joined`, await db.$transaction((tx) => claimInvitation(tx, user.id, code)));
    }
    lines.push({ email: m.email, role: m.label, name, password });
  }
  const text = ["# Comptes des membres : e-mail, rôle, nom, mot de passe (fichier local, à ne pas partager)", ...lines.map((l) => [l.email, l.role, l.name, l.password].join("\t"))].join("\n") + "\n";
  writeFileSync(`${o.file}.tmp`, text, { mode: 0o600 });
  renameSync(`${o.file}.tmp`, o.file);
  const ctx = (role: "manager" | "worker" | "vet"): TenantContext => ({ userId: ids[role], organizationId: farm.organizationId, role });
  return { manager: ctx("manager"), worker: ctx("worker"), vet: ctx("vet"), accountant: ids.accountant, phones: { manager: phones.manager, worker: phones.worker }, file: o.file, created, rotated };
}
