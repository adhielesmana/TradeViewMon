import bcrypt from "bcryptjs";
import { db } from "./db";
import { users, type User, type SafeUser } from "@shared/schema";
import { eq } from "drizzle-orm";

const SALT_ROUNDS = 10;

const SUPERADMIN_USERNAME = "adhielesmana";
const SUPERADMIN_PASSWORD = "admin123";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export async function createUser(username: string, password: string, role: string = "user"): Promise<SafeUser> {
  const hashedPassword = await hashPassword(password);
  
  const [newUser] = await db.insert(users).values({
    username,
    password: hashedPassword,
    role,
  }).returning();

  const { password: _, ...safeUser } = newUser;
  return safeUser;
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  return user;
}

export async function findUserById(id: string): Promise<SafeUser | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) return undefined;
  
  const { password: _, ...safeUser } = user;
  return safeUser;
}

export async function authenticateUser(username: string, password: string): Promise<SafeUser | null> {
  const user = await findUserByUsername(username);
  if (!user) return null;

  const isValid = await verifyPassword(password, user.password);
  if (!isValid) return null;

  await db.update(users)
    .set({ lastLogin: new Date() })
    .where(eq(users.id, user.id));

  const { password: _, ...safeUser } = user;
  return safeUser;
}

export async function seedSuperadmin(): Promise<void> {
  const existingAdmin = await findUserByUsername(SUPERADMIN_USERNAME);
  
  if (!existingAdmin) {
    console.log("Creating superadmin user...");
    await createUser(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, "superadmin");
    console.log("Superadmin created successfully");
  } else {
    console.log("Superadmin already exists");
    if (existingAdmin.role !== "superadmin") {
      await db.update(users)
        .set({ role: "superadmin" })
        .where(eq(users.id, existingAdmin.id));
      console.log("Updated existing user to superadmin role");
    }
  }
}

export function getSafeUser(user: User): SafeUser {
  const { password: _, ...safeUser } = user;
  return safeUser;
}
