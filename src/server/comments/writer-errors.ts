export class WriteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WriteError";
    this.status = status;
  }
}
