/** An error that maps to an HTTP status and `{ error }` body. */
export class HttpProblem extends Error {
  override name = 'HttpProblem';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
