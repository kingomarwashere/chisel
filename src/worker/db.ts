export interface DesignRow {
  id: string;
  uid: string;
  title: string;
  script: string;
  messages: string;
  created_at: number;
  updated_at: number;
}

export interface DesignSummary {
  id: string;
  title: string;
  updated_at: number;
  mine: boolean;
}

export async function listDesigns(db: D1Database, uid: string): Promise<DesignSummary[]> {
  const { results } = await db
    .prepare("SELECT id, title, updated_at FROM designs WHERE uid = ? ORDER BY updated_at DESC LIMIT 100")
    .bind(uid)
    .all<{ id: string; title: string; updated_at: number }>();
  return (results ?? []).map((r) => ({ ...r, mine: true }));
}

export async function getDesign(db: D1Database, id: string): Promise<DesignRow | null> {
  return db.prepare("SELECT * FROM designs WHERE id = ?").bind(id).first<DesignRow>();
}

export async function saveDesign(
  db: D1Database,
  uid: string,
  d: { id?: string; title: string; script: string; messages: unknown },
  now: number
): Promise<string> {
  const id = d.id ?? crypto.randomUUID();
  const messages = JSON.stringify(d.messages ?? []);

  // Upsert — but only the owner may overwrite an existing row.
  const existing = await getDesign(db, id);
  if (existing && existing.uid !== uid) {
    // Someone editing a design that isn't theirs → fork it under a new id.
    return saveDesign(db, uid, { title: d.title, script: d.script, messages: d.messages }, now);
  }

  if (existing) {
    await db
      .prepare("UPDATE designs SET title = ?, script = ?, messages = ?, updated_at = ? WHERE id = ?")
      .bind(d.title, d.script, messages, now, id)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO designs (id, uid, title, script, messages, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
      )
      .bind(id, uid, d.title, d.script, messages, now, now)
      .run();
  }
  return id;
}

export async function deleteDesign(db: D1Database, uid: string, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM designs WHERE id = ? AND uid = ?").bind(id, uid).run();
  return (res.meta.changes ?? 0) > 0;
}
