/**
 * Tagged error so the HTTP layer can map writer failures back to the right
 * status code without re-parsing the message.
 */
export class WriteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WriteError";
    this.status = status;
  }
}
