// Kegagalan yang boleh dilihat pemanggil: status HTTP, kode tetap, dan pesan untuk manusia.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
