export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}
export class NotFoundError extends HttpError {
  constructor(msg: string) {
    super(404, msg);
    this.name = "NotFoundError";
  }
}
export class ConflictError extends HttpError {
  constructor(msg: string) {
    super(409, msg);
    this.name = "ConflictError";
  }
}
export class BadRequestError extends HttpError {
  constructor(msg: string) {
    super(400, msg);
    this.name = "BadRequestError";
  }
}
