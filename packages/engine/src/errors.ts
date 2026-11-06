export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const notFound = (what = "Not found") => new HttpError(404, what);
export const bad = (why: string) => new HttpError(400, why);
