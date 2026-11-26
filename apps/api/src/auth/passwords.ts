import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** Hash used to equalise timing when the email does not exist. */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword('dummy-password-for-timing-0'));
