import * as jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;

export function getUserIdFromToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}
