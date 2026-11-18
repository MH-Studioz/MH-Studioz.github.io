export interface DriverAccount {
  id: string;
  name: string;
  guest: boolean;
  createdAt: number;
}

interface StoredAccount {
  id: string;
  name: string;
  salt: string;
  hash: string;
  createdAt: number;
}

const PROFILES_KEY = 'gp2026.accounts.v1';
const SESSION_KEY = 'gp2026.account.session.v1';

function randomId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function readProfiles(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredAccount[]) : [];
  } catch {
    return [];
  }
}

function writeProfiles(profiles: StoredAccount[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

function writeSession(account: DriverAccount | null): void {
  try {
    if (!account) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(account));
  } catch {
    /* storage can be unavailable */
  }
}

export function currentAccount(): DriverAccount | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DriverAccount>;
    if (!parsed.id || !parsed.name) return null;
    return {
      id: parsed.id,
      name: parsed.name.slice(0, 20),
      guest: Boolean(parsed.guest),
      createdAt: Number(parsed.createdAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function signOut(): void {
  writeSession(null);
}

export function hasRegisteredDrivers(): boolean {
  return readProfiles().length > 0;
}

export async function createDriver(name: string, password: string): Promise<DriverAccount> {
  const cleanName = name.trim().slice(0, 20);
  if (cleanName.length < 2) throw new Error('Driver name needs at least 2 characters.');
  if (password.length < 4) throw new Error('Password needs at least 4 characters.');
  const profiles = readProfiles();
  if (profiles.some((p) => p.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('That driver name is already registered on this device.');
  }
  const salt = randomId('salt');
  const hash = await hashPassword(password, salt);
  const profile: StoredAccount = {
    id: randomId('driver'),
    name: cleanName,
    salt,
    hash,
    createdAt: Date.now(),
  };
  profiles.push(profile);
  writeProfiles(profiles);
  const account: DriverAccount = {
    id: profile.id,
    name: profile.name,
    guest: false,
    createdAt: profile.createdAt,
  };
  writeSession(account);
  return account;
}

export async function signInDriver(name: string, password: string): Promise<DriverAccount> {
  const cleanName = name.trim().toLowerCase();
  const profile = readProfiles().find((p) => p.name.toLowerCase() === cleanName);
  if (!profile) throw new Error('No driver with that name on this device.');
  const hash = await hashPassword(password, profile.salt);
  if (hash !== profile.hash) throw new Error('Password does not match that driver.');
  const account: DriverAccount = {
    id: profile.id,
    name: profile.name,
    guest: false,
    createdAt: profile.createdAt,
  };
  writeSession(account);
  return account;
}

export function continueAsGuest(name?: string): DriverAccount {
  const existing = currentAccount();
  if (existing?.guest) return existing;
  const account: DriverAccount = {
    id: randomId('guest'),
    name: (name?.trim().slice(0, 20) || `GUEST ${Math.floor(1000 + Math.random() * 9000)}`).toUpperCase(),
    guest: true,
    createdAt: Date.now(),
  };
  writeSession(account);
  return account;
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
