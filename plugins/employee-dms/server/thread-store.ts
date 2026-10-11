import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { threadDocumentSchema, type ThreadDocument } from "../shared/threads.js";
export class ThreadStore {
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read() {
    await this.writing;
    return this.load();
  }
  private async load(): Promise<ThreadDocument> {
    try {
      return threadDocumentSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, dms: [], threads: [] };
      throw new Error(
        "Saved employee threads could not be read. The original file has been preserved.",
        { cause: error },
      );
    }
  }
  private async save(serialized: string) {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, serialized, { mode: 0o600, flag: "wx" });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  update<T>(change: (document: ThreadDocument) => T): Promise<T> {
    const operation = this.writing.then(async () => {
      const document = await this.load(),
        before = JSON.stringify(document);
      const result = change(document),
        serialized = JSON.stringify(threadDocumentSchema.parse(document));
      if (serialized !== before) await this.save(serialized);
      return structuredClone(result);
    });
    this.writing = operation.catch(() => undefined);
    return operation;
  }
}
