// Every failure a caller should see: HTTP status, stable code, and a message for people.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
