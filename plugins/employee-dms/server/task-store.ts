import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { taskDocumentSchema, type Task } from "../shared/tasks.js";

export class TaskStore {
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read(): Promise<Task[]> {
    await this.writing;
    return this.load();
  }
  private async load(): Promise<Task[]> {
    try {
      return taskDocumentSchema.parse(JSON.parse(await readFile(this.file, "utf8"))).tasks;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Saved tasks could not be read. The original file has been preserved.", {
        cause: error,
      });
    }
  }
  private async save(document: string) {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, document, { mode: 0o600, flag: "wx" });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  update<T>(change: (tasks: Task[]) => T): Promise<T> {
    const operation = this.writing.then(async () => {
      const tasks = await this.load();
      const before = JSON.stringify(tasks);
      const result = change(tasks);
      const document = taskDocumentSchema.parse({ version: 1, tasks });
      if (JSON.stringify(document.tasks) === before) return structuredClone(result);
      await this.save(JSON.stringify(document));
      return structuredClone(result);
    });
    this.writing = operation.catch(() => undefined);
    return operation;
  }
}
