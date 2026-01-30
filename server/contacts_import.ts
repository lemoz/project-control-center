import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import {
  createPerson,
  createPersonIdentifier,
  getDb,
  normalizeEmail,
  normalizePhone,
  resolvePersonByIdentifier,
  updatePerson,
  type PersonDetails,
  type PersonPatch,
} from "./db.js";
import { getMacContacts, type MacContact } from "./mac_connector.js";

type ImportSource = "mac-contacts" | "legacy-imessage-crm";

type ImportError = {
  name: string | null;
  reason: string;
};

export type ImportReport = {
  source: ImportSource;
  dry_run: boolean;
  imported: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
  total_processed: number;
};

type ImportResult =
  | { ok: true; report: ImportReport }
  | { ok: false; status: number; error: string };

type IdentifierInput = {
  type: "phone" | "email";
  value: string;
  normalized: string;
  label: string | null;
};

type ImportContact = {
  name: string | null;
  nickname: string | null;
  company: string | null;
  role: string | null;
  notes: string | null;
  metadataNotes: string | null;
  phones: Array<{ label: string | null; value: string }>;
  emails: Array<{ label: string | null; value: string }>;
};

type LegacyTableInfo = {
  name: string;
  columns: string[];
};

type DryRunState = {
  peopleById: Map<string, PersonDetails>;
  identifiers: Map<string, string>;
};

type ExistingPersonResolution = {
  person: PersonDetails | null;
  conflict: boolean;
};

const CONTACT_BATCH_SIZE = 100;
const LEGACY_DB_RELATIVE = path.join(".imessage_crm", "contacts.db");

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isBlank(value: string | null | undefined): boolean {
  return !value || !value.trim();
}

function buildImportReport(source: ImportSource, dryRun: boolean): ImportReport {
  return {
    source,
    dry_run: dryRun,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    total_processed: 0,
  };
}

function createDryRunState(): DryRunState {
  return {
    peopleById: new Map(),
    identifiers: new Map(),
  };
}

function registerDryRunPerson(state: DryRunState, person: PersonDetails): PersonDetails {
  const existing = state.peopleById.get(person.id);
  if (existing) return existing;
  const clone: PersonDetails = {
    ...person,
    tags: [...person.tags],
    identifiers: person.identifiers.map((identifier) => ({ ...identifier })),
    projects: person.projects.map((project) => ({ ...project })),
  };
  state.peopleById.set(clone.id, clone);
  for (const identifier of clone.identifiers) {
    state.identifiers.set(
      `${identifier.type}:${identifier.normalized_value}`,
      clone.id
    );
  }
  return clone;
}

function applyDryRunPatch(person: PersonDetails, patch: PersonPatch): void {
  if (patch.name !== undefined) person.name = patch.name;
  if (patch.nickname !== undefined) person.nickname = patch.nickname;
  if (patch.company !== undefined) person.company = patch.company;
  if (patch.role !== undefined) person.role = patch.role;
  if (patch.notes !== undefined) person.notes = patch.notes;
  if (patch.tags !== undefined) person.tags = [...patch.tags];
  if (patch.starred !== undefined) person.starred = patch.starred;
  person.updated_at = new Date().toISOString();
}

function addDryRunIdentifiers(
  state: DryRunState,
  person: PersonDetails,
  identifiers: IdentifierInput[]
): void {
  const now = new Date().toISOString();
  for (const identifier of identifiers) {
    const entry = {
      id: crypto.randomUUID(),
      person_id: person.id,
      type: identifier.type,
      value: identifier.value,
      normalized_value: identifier.normalized,
      label: identifier.label,
      created_at: now,
    };
    person.identifiers.push(entry);
    state.identifiers.set(`${entry.type}:${entry.normalized_value}`, person.id);
  }
}

function buildSourceNotes(source: ImportSource, parts: Array<string | null>): string | null {
  const cleaned = parts
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  if (!cleaned.length) return null;
  const prefix =
    source === "mac-contacts"
      ? "[Imported from Mac Contacts]"
      : "[Imported from Legacy iMessage CRM]";
  return [prefix, ...cleaned].join("\n");
}

function mergeTags(existing: string[], additions: string[]): { tags: string[]; changed: boolean } {
  const merged = [...existing];
  const seen = new Set(existing.map((tag) => tag.toLowerCase()));
  let changed = false;
  for (const tag of additions) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
    changed = true;
  }
  return { tags: merged, changed };
}

function collectIdentifiers(
  phones: Array<{ label: string | null; value: string }>,
  emails: Array<{ label: string | null; value: string }>
): IdentifierInput[] {
  const entries: IdentifierInput[] = [];
  for (const phone of phones) {
    const value = typeof phone.value === "string" ? phone.value.trim() : "";
    if (!value) continue;
    const normalized = normalizePhone(value);
    if (!normalized) continue;
    entries.push({
      type: "phone",
      value,
      normalized,
      label: normalizeOptionalText(phone.label),
    });
  }
  for (const email of emails) {
    const value = typeof email.value === "string" ? email.value.trim() : "";
    if (!value) continue;
    const normalized = normalizeEmail(value);
    if (!normalized) continue;
    entries.push({
      type: "email",
      value,
      normalized,
      label: normalizeOptionalText(email.label),
    });
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.type}:${entry.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveExistingPerson(
  identifiers: IdentifierInput[],
  dryRunState?: DryRunState
): ExistingPersonResolution {
  const matches = new Map<string, PersonDetails>();

  for (const identifier of identifiers) {
    let person: PersonDetails | null = null;
    if (dryRunState) {
      const key = `${identifier.type}:${identifier.normalized}`;
      const personId = dryRunState.identifiers.get(key);
      if (personId) {
        const cached = dryRunState.peopleById.get(personId);
        if (cached) person = cached;
      }
    }

    if (!person) {
      const resolved = resolvePersonByIdentifier({
        type: identifier.type,
        normalizedValue: identifier.normalized,
      });
      if (resolved) {
        person = dryRunState ? registerDryRunPerson(dryRunState, resolved) : resolved;
      }
    }

    if (person) {
      matches.set(person.id, person);
      if (matches.size > 1) {
        return { person: null, conflict: true };
      }
    }
  }

  if (matches.size === 1) {
    const person = matches.values().next().value ?? null;
    return { person, conflict: false };
  }
  return { person: null, conflict: false };
}

function computeIdentifierAdds(
  existing: PersonDetails,
  identifiers: IdentifierInput[]
): IdentifierInput[] {
  const existingKeys = new Set(
    existing.identifiers.map((entry) => `${entry.type}:${entry.normalized_value}`)
  );
  return identifiers.filter(
    (entry) => !existingKeys.has(`${entry.type}:${entry.normalized}`)
  );
}

function applyExistingPersonMerge(params: {
  person: PersonDetails;
  contact: ImportContact;
  source: ImportSource;
  identifiers: IdentifierInput[];
  dryRun: boolean;
  report: ImportReport;
  dryRunState?: DryRunState;
}): void {
  const { person, contact, source, identifiers, dryRun, report, dryRunState } = params;
  const patch: PersonPatch = {};

  if (isBlank(person.name) && contact.name) {
    patch.name = contact.name.trim();
  }
  if (isBlank(person.nickname) && contact.nickname) {
    patch.nickname = contact.nickname;
  }
  if (isBlank(person.company) && contact.company) {
    patch.company = contact.company;
  }
  if (isBlank(person.role) && contact.role) {
    patch.role = contact.role;
  }

  const importedNotes = buildSourceNotes(source, [contact.notes, contact.metadataNotes]);
  if (importedNotes) {
    if (isBlank(person.notes)) {
      patch.notes = importedNotes;
    } else if (!person.notes?.includes(importedNotes)) {
      patch.notes = `${person.notes?.trim()}\n\n${importedNotes}`;
    }
  }

  const { tags, changed: tagsChanged } = mergeTags(person.tags, [source]);
  if (tagsChanged) {
    patch.tags = tags;
  }

  const newIdentifiers = computeIdentifierAdds(person, identifiers);
  const hasPatch = Object.keys(patch).length > 0;
  const hasNewIdentifiers = newIdentifiers.length > 0;
  const hasChanges = hasPatch || hasNewIdentifiers;

  if (!hasChanges) {
    report.skipped += 1;
    return;
  }

  if (!dryRun) {
    if (hasPatch) {
      updatePerson(person.id, patch);
    }
    if (hasNewIdentifiers) {
      for (const identifier of newIdentifiers) {
        const created = createPersonIdentifier({
          person_id: person.id,
          type: identifier.type,
          value: identifier.value,
          label: identifier.label,
        });
        if (!created) {
          report.errors.push({
            name: contact.name,
            reason: `Failed to add ${identifier.type} identifier "${identifier.value}".`,
          });
        }
      }
    }
  } else if (dryRunState) {
    if (hasPatch) {
      applyDryRunPatch(person, patch);
    }
    if (hasNewIdentifiers) {
      addDryRunIdentifiers(dryRunState, person, newIdentifiers);
    }
  }

  report.updated += 1;
}

function applyNewPersonImport(params: {
  contact: ImportContact;
  source: ImportSource;
  identifiers: IdentifierInput[];
  dryRun: boolean;
  report: ImportReport;
  dryRunState?: DryRunState;
}): void {
  const { contact, source, identifiers, dryRun, report, dryRunState } = params;
  if (!contact.name) {
    report.skipped += 1;
    report.errors.push({ name: null, reason: "Missing contact name." });
    return;
  }

  const notes = buildSourceNotes(source, [contact.notes, contact.metadataNotes]);
  if (dryRun) {
    report.imported += 1;
    if (dryRunState) {
      const now = new Date().toISOString();
      const person: PersonDetails = {
        id: crypto.randomUUID(),
        name: contact.name,
        nickname: contact.nickname,
        company: contact.company,
        role: contact.role,
        notes,
        tags: [source],
        starred: false,
        created_at: now,
        updated_at: now,
        identifiers: [],
        projects: [],
      };
      dryRunState.peopleById.set(person.id, person);
      addDryRunIdentifiers(dryRunState, person, identifiers);
    }
    return;
  }

  const person = createPerson({
    name: contact.name,
    nickname: contact.nickname,
    company: contact.company,
    role: contact.role,
    notes,
    tags: [source],
    starred: false,
  });

  for (const identifier of identifiers) {
    const created = createPersonIdentifier({
      person_id: person.id,
      type: identifier.type,
      value: identifier.value,
      label: identifier.label,
    });
    if (!created) {
      report.errors.push({
        name: contact.name,
        reason: `Failed to add ${identifier.type} identifier "${identifier.value}".`,
      });
    }
  }

  report.imported += 1;
}

function processContact(params: {
  contact: ImportContact;
  source: ImportSource;
  dryRun: boolean;
  report: ImportReport;
  dryRunState?: DryRunState;
}): void {
  const { contact, source, dryRun, report, dryRunState } = params;
  if (!contact.name) {
    report.skipped += 1;
    report.errors.push({ name: null, reason: "Missing contact name." });
    return;
  }

  const identifiers = collectIdentifiers(contact.phones, contact.emails);
  const resolution = resolveExistingPerson(identifiers, dryRunState);
  if (resolution.conflict) {
    report.skipped += 1;
    report.errors.push({
      name: contact.name,
      reason: "Multiple existing people matched identifiers; skipping to avoid incorrect merge.",
    });
    return;
  }
  if (resolution.person) {
    applyExistingPersonMerge({
      person: resolution.person,
      contact,
      source,
      identifiers,
      dryRun,
      report,
      dryRunState,
    });
    return;
  }

  applyNewPersonImport({
    contact,
    source,
    identifiers,
    dryRun,
    report,
    dryRunState,
  });
}

function runImport(params: {
  source: ImportSource;
  dryRun: boolean;
  contacts: ImportContact[];
}): ImportReport {
  const report = buildImportReport(params.source, params.dryRun);
  report.total_processed = params.contacts.length;
  const dryRunState = params.dryRun ? createDryRunState() : undefined;

  const processAll = () => {
    for (let idx = 0; idx < params.contacts.length; idx += CONTACT_BATCH_SIZE) {
      const batch = params.contacts.slice(idx, idx + CONTACT_BATCH_SIZE);
      for (const contact of batch) {
        processContact({
          contact,
          source: params.source,
          dryRun: params.dryRun,
          report,
          dryRunState,
        });
      }
    }
  };

  if (params.dryRun) {
    processAll();
    return report;
  }

  const db = getDb();
  const tx = db.transaction(() => {
    processAll();
  });
  tx();
  return report;
}

function toImportContact(contact: MacContact): ImportContact {
  return {
    name: normalizeString(contact.name),
    nickname: null,
    company: null,
    role: null,
    notes: null,
    metadataNotes: null,
    phones: contact.phones.map((phone) => ({
      label: normalizeOptionalText(phone.label),
      value: phone.value,
    })),
    emails: contact.emails.map((email) => ({
      label: normalizeOptionalText(email.label),
      value: email.value,
    })),
  };
}

function extractContactValues(raw: unknown): Array<{ value: string; label: string | null }> {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => extractContactValues(entry));
  }
  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const value = normalizeString(record.value);
    if (!value) return [];
    const label = normalizeOptionalText(record.label);
    return [{ value, label }];
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return [{ value: String(raw), label: null }];
  }
  if (typeof raw !== "string") return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.flatMap((entry) => extractContactValues(entry));
      }
    } catch {
      // Fall back to delimiter split.
    }
  }
  const parts = trimmed.split(/[,\n;]+/).map((entry) => entry.trim()).filter(Boolean);
  if (!parts.length) return [];
  return parts.map((part) => ({ value: part, label: null }));
}

function deriveLabel(key: string): string | null {
  if (key.includes("home")) return "home";
  if (key.includes("work")) return "work";
  if (key.includes("mobile") || key.includes("cell")) return "mobile";
  return null;
}

function collectValuesByKeyword(
  record: Record<string, unknown>,
  keywords: string[],
  usedKeys: Set<string>
): Array<{ label: string | null; value: string }> {
  const results: Array<{ label: string | null; value: string }> = [];
  for (const [key, raw] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (!keywords.some((keyword) => lowerKey.includes(keyword))) continue;
    if (lowerKey.includes("label") || lowerKey.includes("type") || lowerKey.includes("kind")) {
      continue;
    }
    const values = extractContactValues(raw);
    if (!values.length) continue;
    usedKeys.add(key);
    const derived = deriveLabel(lowerKey);
    for (const entry of values) {
      results.push({
        value: entry.value,
        label: entry.label ?? derived,
      });
    }
  }
  return results;
}

function pickFirstString(
  record: Record<string, unknown>,
  keys: string[],
  usedKeys: Set<string>
): string | null {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = normalizeString(record[key]);
    if (!value) continue;
    usedKeys.add(key);
    return value;
  }
  return null;
}

function buildMetadataNotes(
  record: Record<string, unknown>,
  usedKeys: Set<string>
): string | null {
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(record)) {
    if (usedKeys.has(key)) continue;
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "object") continue;
    const value = typeof raw === "string" ? raw.trim() : String(raw);
    if (!value) continue;
    lines.push(`${key}: ${value}`);
  }
  return lines.length ? lines.join("\n") : null;
}

function mapLegacyContact(record: Record<string, unknown>): ImportContact {
  const usedKeys = new Set<string>();
  const primaryName = pickFirstString(
    record,
    ["name", "full_name", "display_name", "contact_name"],
    usedKeys
  );
  const firstName = pickFirstString(
    record,
    ["first_name", "first", "given_name"],
    usedKeys
  );
  const lastName = pickFirstString(
    record,
    ["last_name", "last", "surname", "family_name"],
    usedKeys
  );
  const combinedName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const name = primaryName ?? (combinedName ? combinedName : null);

  const nickname = pickFirstString(record, ["nickname", "nick_name"], usedKeys);
  const company = pickFirstString(
    record,
    ["company", "organization", "org", "employer"],
    usedKeys
  );
  const role = pickFirstString(record, ["role", "title", "job_title", "position"], usedKeys);
  const notes = pickFirstString(record, ["notes", "note", "memo"], usedKeys);

  const phones = collectValuesByKeyword(record, ["phone", "mobile", "cell"], usedKeys);
  const emails = collectValuesByKeyword(record, ["email"], usedKeys);

  const metadataNotes = buildMetadataNotes(record, usedKeys);

  return {
    name,
    nickname,
    company,
    role,
    notes,
    metadataNotes,
    phones,
    emails,
  };
}

function listLegacyTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function getTableColumns(db: Database.Database, table: string): string[] {
  const quoted = `"${table.replace(/"/g, "\"\"")}"`;
  const rows = db.prepare(`PRAGMA table_info(${quoted})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function scoreLegacyTable(columns: string[]): number {
  const lower = columns.map((col) => col.toLowerCase());
  let score = 0;
  const hasAny = (candidates: string[]) =>
    candidates.some((candidate) => lower.some((col) => col.includes(candidate)));
  if (hasAny(["name", "full_name", "display_name", "contact_name", "first_name"])) {
    score += 2;
  }
  if (hasAny(["phone", "phone_number", "phone_numbers", "mobile", "cell"])) {
    score += 2;
  }
  if (hasAny(["email", "email_address", "emails"])) {
    score += 2;
  }
  if (hasAny(["nickname", "nick_name"])) score += 1;
  if (hasAny(["company", "organization", "org", "employer"])) score += 1;
  if (hasAny(["role", "title", "job_title", "position"])) score += 1;
  if (hasAny(["notes", "note", "memo"])) score += 1;
  return score;
}

function findLegacyContactsTable(db: Database.Database): LegacyTableInfo | null {
  const tables = listLegacyTables(db);
  let best: LegacyTableInfo | null = null;
  let bestScore = 0;
  for (const table of tables) {
    const columns = getTableColumns(db, table);
    if (!columns.length) continue;
    const score = scoreLegacyTable(columns);
    if (score <= bestScore) continue;
    bestScore = score;
    best = { name: table, columns };
  }
  return bestScore > 0 && best ? best : null;
}

function openLegacyDb(): { ok: true; db: Database.Database } | { ok: false; status: number; error: string } {
  const dbPath = path.join(os.homedir(), LEGACY_DB_RELATIVE);
  try {
    fs.accessSync(dbPath, fs.constants.R_OK);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return { ok: false, status: 404, error: `Legacy contacts DB not found at ${dbPath}.` };
    }
    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, status: 403, error: `Permission denied reading ${dbPath}.` };
    }
    return { ok: false, status: 500, error: `Unable to access ${dbPath}.` };
  }
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return { ok: true, db };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to open legacy DB.";
    return { ok: false, status: 500, error: message };
  }
}

function loadLegacyContacts(
  db: Database.Database,
): { tableFound: boolean; contacts: ImportContact[] } {
  const tableInfo = findLegacyContactsTable(db);
  if (!tableInfo) return { tableFound: false, contacts: [] };
  const quoted = `"${tableInfo.name.replace(/"/g, "\"\"")}"`;
  const rows = db.prepare(`SELECT * FROM ${quoted}`).all() as Record<string, unknown>[];
  return { tableFound: true, contacts: rows.map((row) => mapLegacyContact(row)) };
}

export async function importMacContacts(params: {
  dryRun: boolean;
}): Promise<ImportResult> {
  const result = await getMacContacts();
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error };
  }
  const contacts = result.data.map((contact) => toImportContact(contact));
  return { ok: true, report: runImport({ source: "mac-contacts", dryRun: params.dryRun, contacts }) };
}

export async function importLegacyContacts(params: {
  dryRun: boolean;
}): Promise<ImportResult> {
  const openResult = openLegacyDb();
  if (!openResult.ok) return openResult;
  const { db } = openResult;
  try {
    const { tableFound, contacts } = loadLegacyContacts(db);
    if (!tableFound) {
      return {
        ok: false,
        status: 404,
        error: "Legacy contacts DB has no recognizable contacts table.",
      };
    }
    return {
      ok: true,
      report: runImport({
        source: "legacy-imessage-crm",
        dryRun: params.dryRun,
        contacts,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read legacy contacts.";
    return { ok: false, status: 500, error: message };
  } finally {
    db.close();
  }
}
