export function apiSuccess(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function apiError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function parseBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}
